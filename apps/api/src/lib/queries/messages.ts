import { db } from "@repo/db"
import { chatFeedMessage } from "@repo/db/queries/agent-sessions"
import { visibleToSessionChatFilter } from "@repo/db/queries/session-chat-access"
import type {
  Attachment,
  ChannelEventPayload,
  Embed,
  LorMemory,
  LorReasoningSegment,
  LorToolCall,
} from "@repo/db/schema"
import {
  agentRun,
  approval,
  channel,
  message,
  messageMention,
  messageReaction,
  plan,
  user,
  workspaceMember,
} from "@repo/db/schema"
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  max,
  or,
  type SQL,
} from "drizzle-orm"

export async function getAvatarColorsByUserId(
  scope: { workspaceId: string } | { channelId: string },
  userIds: Iterable<string>
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return new Map()

  const colorSelection = {
    userId: workspaceMember.userId,
    avatarColor: workspaceMember.avatarColor,
  }
  const rows =
    "workspaceId" in scope
      ? await db
          .select(colorSelection)
          .from(workspaceMember)
          .where(
            and(
              eq(workspaceMember.workspaceId, scope.workspaceId),
              inArray(workspaceMember.userId, ids)
            )
          )
      : await db
          .select(colorSelection)
          .from(workspaceMember)
          .innerJoin(
            channel,
            eq(channel.workspaceId, workspaceMember.workspaceId)
          )
          .where(
            and(
              eq(channel.id, scope.channelId),
              inArray(workspaceMember.userId, ids)
            )
          )

  return new Map(rows.map((row) => [row.userId, row.avatarColor]))
}

type BareMessageRow = {
  id: string
  channelId: string
  content: string | null
  type: (typeof message.type.enumValues)[number]
  status: (typeof message.status.enumValues)[number]
  eventType: (typeof message.eventType.enumValues)[number] | null
  eventPayload: ChannelEventPayload | null
  pinned: boolean
  attachments: Attachment[] | null
  embeds: Embed[] | null
  lorToolCalls: LorToolCall[] | null
  lorMemories: LorMemory[] | null
  lorReasoning: string | null
  lorReasoningSegments: LorReasoningSegment[] | null
  overrideName: string | null
  overrideAvatarUrl: string | null
  referencedMessageId: string | null
  threadRootId: string | null
  routedToLor: boolean | null
  editedAt: Date | null
  createdAt: Date
  authorId: string
  author: {
    id: string
    name: string
    image: string | null
  }
}

export const messageSelect = {
  id: message.id,
  channelId: message.channelId,
  content: message.content,
  type: message.type,
  status: message.status,
  eventType: message.eventType,
  eventPayload: message.eventPayload,
  pinned: message.pinned,
  attachments: message.attachments,
  embeds: message.embeds,
  lorToolCalls: message.lorToolCalls,
  lorMemories: message.lorMemories,
  lorReasoning: message.lorReasoning,
  lorReasoningSegments: message.lorReasoningSegments,
  overrideName: message.overrideName,
  overrideAvatarUrl: message.overrideAvatarUrl,
  referencedMessageId: message.referencedMessageId,
  threadRootId: message.threadRootId,
  routedToLor: message.routedToLor,
  editedAt: message.editedAt,
  createdAt: message.createdAt,
  authorId: message.authorId,
  author: {
    id: user.id,
    name: user.name,
    image: user.image,
  },
} as const

export const referencedMessageSelect = {
  id: message.id,
  content: message.content,
  authorId: user.id,
  authorName: user.name,
  authorImage: user.image,
  overrideName: message.overrideName,
  overrideAvatarUrl: message.overrideAvatarUrl,
} as const

export function toReferencedMessage(row: {
  id: string
  content: string | null
  authorId: string
  authorName: string
  authorImage: string | null
  overrideName: string | null
  overrideAvatarUrl: string | null
}) {
  return {
    id: row.id,
    content: row.content,
    author: {
      id: row.authorId,
      name: row.authorName,
      image: row.authorImage,
    },
    overrideName: row.overrideName,
    overrideAvatarUrl: row.overrideAvatarUrl,
  }
}

type FetchMessagesParams = {
  channelId: string
  currentUserId: string
  limit: number
  // mutually exclusive — at most one is set. If none, returns the latest page.
  around?: string
  before?: string
  after?: string
  // When set, fetches thread replies under this root. Otherwise fetches
  // channel messages (excluding thread replies).
  threadRootId?: string
}

export async function fetchMessages({
  channelId,
  currentUserId,
  limit,
  around,
  before,
  after,
  threadRootId,
}: FetchMessagesParams) {
  const anchorId = around ?? before ?? after ?? null

  // Scope filter: thread replies under a root, or channel messages
  // (excluding thread replies).
  const scopeCondition: SQL | undefined = threadRootId
    ? and(
        eq(message.channelId, channelId),
        eq(message.threadRootId, threadRootId)
      )
    : and(eq(message.channelId, channelId), chatFeedMessage())

  // Look up the anchor's (createdAt, id) so we can do stable comparisons
  // even when multiple messages share a millisecond timestamp.
  let anchor: { id: string; createdAt: Date } | null = null
  if (anchorId) {
    const rows = await db
      .select({ id: message.id, createdAt: message.createdAt })
      .from(message)
      .where(and(eq(message.id, anchorId), scopeCondition))
      .limit(1)
    anchor = rows[0] ?? null

    if (!anchor) {
      // Anchor doesn't exist in this channel — return empty result. The
      // frontend will surface a "message not found" state.
      return {
        data: [],
        beforeCursor: null,
        afterCursor: null,
        reachedOldest: true,
        reachedNewest: true,
      }
    }
  }

  let messages: BareMessageRow[] = []
  let reachedOldest = false
  let reachedNewest = false

  if (around && anchor) {
    const slots = limit - 1 // exclude the anchor itself
    const halfBefore = Math.floor(slots / 2)
    const halfAfter = Math.ceil(slots / 2)

    // Fetch limit+1 each side so a half running short can borrow slots.
    const [olderRows, newerRows, anchorRow] = await Promise.all([
      db
        .select(messageSelect)
        .from(message)
        .innerJoin(user, eq(message.authorId, user.id))
        .where(
          and(
            scopeCondition,
            or(
              lt(message.createdAt, anchor.createdAt),
              and(
                eq(message.createdAt, anchor.createdAt),
                lt(message.id, anchor.id)
              )
            )
          )
        )
        .orderBy(desc(message.createdAt), desc(message.id))
        .limit(limit + 1),
      db
        .select(messageSelect)
        .from(message)
        .innerJoin(user, eq(message.authorId, user.id))
        .where(
          and(
            scopeCondition,
            or(
              gt(message.createdAt, anchor.createdAt),
              and(
                eq(message.createdAt, anchor.createdAt),
                gt(message.id, anchor.id)
              )
            )
          )
        )
        .orderBy(asc(message.createdAt), asc(message.id))
        .limit(limit + 1),
      db
        .select(messageSelect)
        .from(message)
        .innerJoin(user, eq(message.authorId, user.id))
        .where(eq(message.id, anchor.id))
        .limit(1),
    ])

    // Donate unused slots from a short half to the other side.
    let useNewer = Math.min(halfAfter, newerRows.length)
    let useOlder = Math.min(halfBefore, olderRows.length)
    if (useNewer < halfAfter) {
      const surplus = halfAfter - useNewer
      useOlder = Math.min(
        useOlder + surplus,
        olderRows.length,
        slots - useNewer
      )
    } else if (useOlder < halfBefore) {
      const surplus = halfBefore - useOlder
      useNewer = Math.min(
        useNewer + surplus,
        newerRows.length,
        slots - useOlder
      )
    }

    reachedOldest = olderRows.length <= useOlder
    reachedNewest = newerRows.length <= useNewer

    // Newest-first: [newest...anchor...oldest]
    messages = [
      ...newerRows.slice(0, useNewer).reverse(),
      ...anchorRow,
      ...olderRows.slice(0, useOlder),
    ]
  } else if (before && anchor) {
    const rows = await db
      .select(messageSelect)
      .from(message)
      .innerJoin(user, eq(message.authorId, user.id))
      .where(
        and(
          scopeCondition,
          or(
            lt(message.createdAt, anchor.createdAt),
            and(
              eq(message.createdAt, anchor.createdAt),
              lt(message.id, anchor.id)
            )
          )
        )
      )
      .orderBy(desc(message.createdAt), desc(message.id))
      .limit(limit + 1)

    reachedOldest = rows.length <= limit
    messages = rows.slice(0, limit)
    // We know there are newer messages — the anchor itself.
    reachedNewest = false
  } else if (after && anchor) {
    const rows = await db
      .select(messageSelect)
      .from(message)
      .innerJoin(user, eq(message.authorId, user.id))
      .where(
        and(
          scopeCondition,
          or(
            gt(message.createdAt, anchor.createdAt),
            and(
              eq(message.createdAt, anchor.createdAt),
              gt(message.id, anchor.id)
            )
          )
        )
      )
      .orderBy(asc(message.createdAt), asc(message.id))
      .limit(limit + 1)

    reachedNewest = rows.length <= limit
    messages = rows.slice(0, limit).reverse() // back to newest-first
    reachedOldest = false
  } else {
    // No anchor — latest page.
    const rows = await db
      .select(messageSelect)
      .from(message)
      .innerJoin(user, eq(message.authorId, user.id))
      .where(scopeCondition)
      .orderBy(desc(message.createdAt), desc(message.id))
      .limit(limit + 1)

    reachedOldest = rows.length <= limit
    reachedNewest = true
    messages = rows.slice(0, limit)
  }

  const messageIds = messages.map((msg) => msg.id)
  const referencedMessageIds = messages
    .map((msg) => msg.referencedMessageId)
    .filter((id): id is string => id !== null)
  // Referenced messages are joined into the same mention lookup rather than
  // getting their own query: a reply preview has to resolve the stored `<@uuid>`
  // tokens in the message it quotes, or it renders raw ids.
  const mentionLookupIds = [
    ...new Set([...messageIds, ...referencedMessageIds]),
  ]

  const [
    mentionRows,
    reactionRows,
    referencedMessageRows,
    lorRunRows,
    threadSummaryRows,
    threadParticipantRows,
    planWaitingRows,
    approvalWaitingRows,
  ] = await Promise.all([
    mentionLookupIds.length > 0
      ? db
          .select({
            messageId: messageMention.messageId,
            id: user.id,
            name: user.name,
            image: user.image,
          })
          .from(messageMention)
          .innerJoin(user, eq(messageMention.mentionedUserId, user.id))
          .where(
            and(
              inArray(messageMention.messageId, mentionLookupIds),
              eq(messageMention.mentionType, "direct")
            )
          )
      : Promise.resolve([]),
    messageIds.length > 0
      ? db
          .select({
            messageId: messageReaction.messageId,
            emoji: messageReaction.emoji,
            userId: messageReaction.userId,
            userName: user.name,
          })
          .from(messageReaction)
          .innerJoin(user, eq(messageReaction.userId, user.id))
          .where(inArray(messageReaction.messageId, messageIds))
      : Promise.resolve([]),
    (async () => {
      if (referencedMessageIds.length === 0) return []
      return db
        .select(referencedMessageSelect)
        .from(message)
        .innerJoin(user, eq(message.authorId, user.id))
        .where(inArray(message.id, referencedMessageIds))
    })(),
    messageIds.length > 0
      ? db
          .select({
            messageId: agentRun.messageId,
            triggerMessageId: agentRun.triggerMessageId,
          })
          .from(agentRun)
          .where(inArray(agentRun.messageId, messageIds))
      : Promise.resolve([]),
    // Thread summaries only when fetching channel messages, not thread replies.
    // Live-only rule: a live call's chat shows no activity outside the call.
    threadRootId || messageIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            threadRootId: message.threadRootId,
            replyCount: count(),
            lastReplyAt: max(message.createdAt),
          })
          .from(message)
          .where(
            and(
              inArray(message.threadRootId, messageIds),
              visibleToSessionChatFilter(currentUserId, message.threadRootId)
            )
          )
          .groupBy(message.threadRootId),
    threadRootId || messageIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            threadRootId: message.threadRootId,
            createdAt: message.createdAt,
            userId: user.id,
            userName: user.name,
            userImage: user.image,
          })
          .from(message)
          .innerJoin(user, eq(message.authorId, user.id))
          .where(
            and(
              inArray(message.threadRootId, messageIds),
              visibleToSessionChatFilter(currentUserId, message.threadRootId)
            )
          )
          .orderBy(desc(message.createdAt)),
    // Blocked-on-a-human footer state, same sources as the live
    // loadThreadSummary: waiting plans and pending approvals (anchored via
    // plan or run — policy-parked approvals on plan-less runs have no plan).
    threadRootId || messageIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ threadRootId: plan.threadRootId, status: plan.status })
          .from(plan)
          .where(
            and(
              inArray(plan.threadRootId, messageIds),
              inArray(plan.status, [
                "waiting_for_input",
                "waiting_for_approval",
              ])
            )
          ),
    threadRootId || messageIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            planThreadRootId: plan.threadRootId,
            runThreadRootId: agentRun.threadRootId,
          })
          .from(approval)
          .leftJoin(plan, eq(approval.planId, plan.id))
          .leftJoin(agentRun, eq(approval.runId, agentRun.id))
          .where(
            and(
              eq(approval.status, "pending"),
              or(
                inArray(plan.threadRootId, messageIds),
                inArray(agentRun.threadRootId, messageIds)
              )
            )
          ),
  ])

  const avatarColorByUserId = await getAvatarColorsByUserId({ channelId }, [
    ...messages.map((msg) => msg.author.id),
    ...mentionRows.map((row) => row.id),
    ...referencedMessageRows.map((row) => row.authorId),
    ...threadParticipantRows.map((row) => row.userId),
  ])

  type ThreadSummary = {
    replyCount: number
    lastReplyAt: string
    lorWaiting: "needs_approval" | "needs_input" | null
    participants: Array<{
      id: string
      name: string
      image: string | null
      avatarColor?: string | null
    }>
  }
  const threadSummaryById = new Map<string, ThreadSummary>()
  for (const row of threadSummaryRows) {
    if (!row.threadRootId || !row.lastReplyAt) continue
    threadSummaryById.set(row.threadRootId, {
      replyCount: Number(row.replyCount),
      lastReplyAt: row.lastReplyAt.toISOString(),
      lorWaiting: null,
      participants: [],
    })
  }
  for (const row of planWaitingRows) {
    const summary = row.threadRootId
      ? threadSummaryById.get(row.threadRootId)
      : undefined
    if (summary) {
      summary.lorWaiting =
        row.status === "waiting_for_approval" ? "needs_approval" : "needs_input"
    }
  }
  // Approvals last: a pending approval outranks a plan's waiting_for_input.
  for (const row of approvalWaitingRows) {
    const rootId = row.planThreadRootId ?? row.runThreadRootId
    const summary = rootId ? threadSummaryById.get(rootId) : undefined
    if (summary) summary.lorWaiting = "needs_approval"
  }
  // Walk participants newest-first; for each root take the first 3 distinct authors.
  const seenAuthorsPerRoot = new Map<string, Set<string>>()
  for (const row of threadParticipantRows) {
    if (!row.threadRootId) continue
    const summary = threadSummaryById.get(row.threadRootId)
    if (!summary || summary.participants.length >= 3) continue
    let seen = seenAuthorsPerRoot.get(row.threadRootId)
    if (!seen) {
      seen = new Set()
      seenAuthorsPerRoot.set(row.threadRootId, seen)
    }
    if (seen.has(row.userId)) continue
    seen.add(row.userId)
    summary.participants.push({
      id: row.userId,
      name: row.userName,
      image: row.userImage,
      avatarColor: avatarColorByUserId.get(row.userId) ?? null,
    })
  }

  const lorTriggerByMessageId = new Map(
    lorRunRows.map((row) => [row.messageId, row.triggerMessageId])
  )

  const mentionsByMessageId = new Map<
    string,
    Array<{
      id: string
      name: string
      image: string | null
      avatarColor?: string | null
    }>
  >()
  const reactionsByMessageId = new Map<
    string,
    Map<
      string,
      {
        emoji: string
        count: number
        reactedByCurrentUser: boolean
        reactors: Array<{ id: string; name: string }>
      }
    >
  >()

  for (const mentionRow of mentionRows) {
    const existingMentions = mentionsByMessageId.get(mentionRow.messageId) ?? []
    existingMentions.push({
      id: mentionRow.id,
      name: mentionRow.name,
      image: mentionRow.image,
      avatarColor: avatarColorByUserId.get(mentionRow.id) ?? null,
    })
    mentionsByMessageId.set(mentionRow.messageId, existingMentions)
  }

  // Built after the mention map so each quoted message can carry the mentions
  // its own content references.
  const referencedMessagesById = new Map(
    referencedMessageRows.map((row) => {
      const referencedMessage = toReferencedMessage(row)
      return [
        row.id,
        {
          ...referencedMessage,
          author: {
            ...referencedMessage.author,
            avatarColor:
              avatarColorByUserId.get(referencedMessage.author.id) ?? null,
          },
          mentions: mentionsByMessageId.get(row.id) ?? [],
        },
      ]
    })
  )

  for (const reactionRow of reactionRows) {
    const reactionsByEmoji =
      reactionsByMessageId.get(reactionRow.messageId) ?? new Map()
    const existingReaction = reactionsByEmoji.get(reactionRow.emoji) ?? {
      emoji: reactionRow.emoji,
      count: 0,
      reactedByCurrentUser: false,
      reactors: [],
    }

    existingReaction.count += 1
    existingReaction.reactors.push({
      id: reactionRow.userId,
      name: reactionRow.userName,
    })
    if (reactionRow.userId === currentUserId) {
      existingReaction.reactedByCurrentUser = true
    }

    reactionsByEmoji.set(reactionRow.emoji, existingReaction)
    reactionsByMessageId.set(reactionRow.messageId, reactionsByEmoji)
  }

  const data = messages.map(({ lorMemories, ...msg }) => ({
    ...msg,
    author: {
      ...msg.author,
      avatarColor: avatarColorByUserId.get(msg.author.id) ?? null,
    },
    embeds: msg.embeds ?? [],
    lorToolCalls: msg.lorToolCalls ?? [],
    lorReasoningSegments: msg.lorReasoningSegments ?? [],
    // Serialized as `remembered` (the brain pages saved during this answer).
    remembered: lorMemories ?? [],
    lorTriggerMessageId: lorTriggerByMessageId.get(msg.id) ?? null,
    mentions: mentionsByMessageId.get(msg.id) ?? [],
    reactions: Array.from(reactionsByMessageId.get(msg.id)?.values() ?? []),
    referencedMessage: msg.referencedMessageId
      ? (referencedMessagesById.get(msg.referencedMessageId) ?? null)
      : null,
    threadSummary: threadSummaryById.get(msg.id) ?? null,
  }))

  const afterCursor = data[0]?.id ?? null
  const beforeCursor = data[data.length - 1]?.id ?? null

  return {
    data,
    beforeCursor,
    afterCursor,
    reachedOldest,
    reachedNewest,
  }
}
