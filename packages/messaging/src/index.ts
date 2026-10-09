import { and, db, eq, inArray, LOR_USER_ID, or, schema } from "@repo/db"
import {
  type ChannelAudienceInfo,
  resolveChannelAudienceInfo,
} from "@repo/db/queries/channel-access"
import { liveSessionChatMembers } from "@repo/db/queries/session-chat-access"
import { subscribeToThread } from "@repo/db/queries/thread-subscriptions"
import type { Embed } from "@repo/db/schema"
import type {
  MentionNotification,
  ReactionNotification,
  RealtimeMessageMention,
  UnreadNotification,
} from "@repo/realtime-types"
import { PRESENCE_ONLINE_USERS_SET_KEY } from "@repo/realtime-types"
import {
  extractDirectMentionUserIds,
  MARKDOWN_USER_MENTION_REGEX,
  USER_MENTION_REGEX,
} from "./mentions"
import type { CallMentionPush } from "./push"

export {
  type ChannelEventContentInput,
  channelEventContent,
  joinNames,
} from "./channel-events"
export {
  extractDirectMentionUserIds,
  MARKDOWN_USER_MENTION_REGEX,
  USER_MENTION_REGEX,
} from "./mentions"
export { loadThreadSummary } from "./thread-summary"

// Minimal shapes so both realtime (human send) and worker (Lor reply) can call this.
type FanoutChannel = {
  id: string
  workspaceId: string | null
  name: string | null
  workspaceName?: string | null
}

type FanoutMessage = {
  id: string
  type?: UnreadNotification["messageType"]
  content: string | null
  author: { name: string; image?: string | null }
  attachments: readonly unknown[]
  embeds?: readonly Embed[]
  threadRootId?: string | null
}

type MessageFanoutInput = {
  authorId: string
  channel: FanoutChannel
  message: FanoutMessage
  // Presence lookup for @here (audience ∩ online). Absent or failing ⇒ @here
  // pings nobody — fail closed, never "everyone by accident".
  redis?: PresenceRedisClient
}

type UserTargetedPayload<T> = {
  userId: string
  payload: T
}

async function resolveThreadNotificationContext(message: FanoutMessage) {
  const threadRootId = message.threadRootId ?? null
  if (!threadRootId) {
    return {
      threadRootId: null,
      isLorThread: false,
      subscribedUserIds: new Set<string>(),
    }
  }

  const [participantRows, planCreator, callRows] = await Promise.all([
    db
      .selectDistinct({ userId: schema.message.authorId })
      .from(schema.message)
      .where(
        or(
          eq(schema.message.id, threadRootId),
          eq(schema.message.threadRootId, threadRootId)
        )
      ),
    db
      .select({ userId: schema.plan.creatorId })
      .from(schema.plan)
      .where(eq(schema.plan.threadRootId, threadRootId))
      .limit(1)
      .then((rows) => rows[0]?.userId ?? null),
    // Everyone who was in a call follows its chat, so they hear about Lor's
    // after-call recap even if they never typed there.
    db
      .selectDistinct({ userId: schema.voiceSessionParticipant.userId })
      .from(schema.voiceSessionParticipant)
      .innerJoin(
        schema.voiceSession,
        eq(schema.voiceSession.id, schema.voiceSessionParticipant.sessionId)
      )
      .where(eq(schema.voiceSession.threadRootId, threadRootId)),
  ])
  const subscribedUserIds = new Set(
    [...participantRows, ...callRows].map((participant) => participant.userId)
  )
  if (planCreator) subscribedUserIds.add(planCreator)

  return {
    threadRootId,
    isLorThread: subscribedUserIds.has(LOR_USER_ID),
    subscribedUserIds,
  }
}

type MentionInsertType =
  (typeof schema.messageMention.$inferInsert)["mentionType"]
type NotificationInsertType = Extract<
  (typeof schema.notificationEvent.$inferInsert)["type"],
  "direct_mention" | "everyone_mention"
>

const EVERYONE_MENTION_REGEX = /(^|\s)@everyone\b/i
const CHANNEL_MENTION_REGEX = /(^|\s)@channel\b/i
const HERE_MENTION_REGEX = /(^|\s)@here\b/i
const mentionNotificationTypes = ["direct_mention", "everyone_mention"] as const

// Structural subset of the node-redis client (same shape push.ts uses) so
// realtime, worker, and api can all pass their own instance.
export type PresenceRedisClient = {
  smIsMember(key: string, members: string[]): Promise<Array<boolean | number>>
}

// @here targets: audience ∩ online. Fail closed — a presence outage means
// nobody gets pinged, never everybody.
async function listOnlineRecipientIds(
  redis: PresenceRedisClient | undefined,
  recipients: string[]
): Promise<Set<string>> {
  if (!redis || recipients.length === 0) return new Set()
  try {
    const membership = await redis.smIsMember(
      PRESENCE_ONLINE_USERS_SET_KEY,
      recipients
    )
    return new Set(
      recipients.filter((_, index) => {
        const value = membership[index]
        return value === true || value === 1
      })
    )
  } catch {
    return new Set()
  }
}

async function listRecipientAudience(channel: FanoutChannel) {
  // Shared audience resolver — restricted-channel messages must not reach
  // non-members' unreads/push.
  return resolveChannelAudienceInfo(channel.id)
}

function buildMentionTargets(args: {
  audience: ChannelAudienceInfo["audience"]
  recipients: string[]
  // Who @everyone/@channel/@here can reach; defaults to all recipients.
  broadcastRecipients?: string[]
  messageContent: string
  onlineRecipientIds: Set<string>
}) {
  const broadcastRecipients = args.broadcastRecipients ?? args.recipients
  const directMentionedUserIds = extractDirectMentionUserIds(
    args.messageContent
  )

  // Broadcast mentions live in workspace channels only (never DMs).
  // @everyone additionally requires the audience to BE the workspace — in a
  // members-only channel it is rejected (no fanout), not narrowed.
  const isWorkspaceChannel =
    args.audience === "workspace" || args.audience === "members"
  const includeEveryone =
    args.audience === "workspace" &&
    EVERYONE_MENTION_REGEX.test(args.messageContent)
  const includeChannel =
    isWorkspaceChannel && CHANNEL_MENTION_REGEX.test(args.messageContent)
  const includeHere =
    isWorkspaceChannel && HERE_MENTION_REGEX.test(args.messageContent)

  const mentionTypeByUserId = new Map<string, MentionInsertType>()
  const recipientSet = new Set(args.recipients)

  for (const userId of directMentionedUserIds) {
    if (recipientSet.has(userId)) {
      mentionTypeByUserId.set(userId, "direct")
    }
  }

  // Broadest first: @everyone/@channel cover the whole audience, @here only
  // whoever is online right now. Direct mentions always win.
  if (includeEveryone || includeChannel) {
    const type: MentionInsertType = includeEveryone ? "everyone" : "channel"
    for (const userId of broadcastRecipients) {
      if (!mentionTypeByUserId.has(userId)) {
        mentionTypeByUserId.set(userId, type)
      }
    }
  } else if (includeHere) {
    for (const userId of broadcastRecipients) {
      if (
        args.onlineRecipientIds.has(userId) &&
        !mentionTypeByUserId.has(userId)
      ) {
        mentionTypeByUserId.set(userId, "here")
      }
    }
  }

  return mentionTypeByUserId
}

// Whether the content can produce an @here target at all — gates the
// presence round-trip.
function needsPresenceLookup(
  audience: ChannelAudienceInfo["audience"],
  content: string
) {
  return (
    (audience === "workspace" || audience === "members") &&
    HERE_MENTION_REGEX.test(content) &&
    !EVERYONE_MENTION_REGEX.test(content) &&
    !CHANNEL_MENTION_REGEX.test(content)
  )
}

function toNotificationType(
  mentionType: MentionInsertType
): NotificationInsertType {
  return mentionType === "direct" ? "direct_mention" : "everyone_mention"
}

function isMentionNotificationType(
  type: (typeof schema.notificationEvent.$inferSelect)["type"]
): type is MentionNotification["type"] {
  return (mentionNotificationTypes as readonly string[]).includes(type)
}

async function listMentionUsers(
  mentionTypeByUserId: Map<string, MentionInsertType>
): Promise<RealtimeMessageMention[]> {
  const directIds = Array.from(mentionTypeByUserId.entries())
    .filter(([, mentionType]) => mentionType === "direct")
    .map(([userId]) => userId)
  if (directIds.length === 0) return []

  const users = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(inArray(schema.user.id, directIds))
  const userById = new Map(users.map((user) => [user.id, user]))
  return directIds.flatMap((userId) => userById.get(userId) ?? [])
}

// Reconciles message_mention rows after an edit and returns the canonical
// direct mentions. Deliberately does not create notification events — edits
// don't re-ping, but fresh mention rows still feed unread mention badges.
export async function syncMessageMentions(input: {
  authorId: string
  channel: FanoutChannel
  messageId: string
  content: string
  redis?: PresenceRedisClient
}): Promise<RealtimeMessageMention[]> {
  const { audience, userIds: allRecipientIds } = await listRecipientAudience(
    input.channel
  )
  const recipientIds = [...new Set(allRecipientIds)].filter(
    (id) => id !== input.authorId
  )
  const onlineRecipientIds = needsPresenceLookup(audience, input.content)
    ? await listOnlineRecipientIds(input.redis, recipientIds)
    : new Set<string>()
  const mentionTypeByUserId = buildMentionTargets({
    audience,
    recipients: recipientIds,
    messageContent: input.content,
    onlineRecipientIds,
  })

  const existingRows = await db
    .select({
      mentionedUserId: schema.messageMention.mentionedUserId,
      mentionType: schema.messageMention.mentionType,
    })
    .from(schema.messageMention)
    .where(eq(schema.messageMention.messageId, input.messageId))
  const existingTypeByUserId = new Map(
    existingRows.map((row) => [row.mentionedUserId, row.mentionType])
  )

  const removedUserIds = existingRows
    .filter(
      (row) => mentionTypeByUserId.get(row.mentionedUserId) !== row.mentionType
    )
    .map((row) => row.mentionedUserId)
  if (removedUserIds.length > 0) {
    await db
      .delete(schema.messageMention)
      .where(
        and(
          eq(schema.messageMention.messageId, input.messageId),
          inArray(schema.messageMention.mentionedUserId, removedUserIds)
        )
      )
  }

  const addedRows = Array.from(mentionTypeByUserId.entries())
    .filter(
      ([userId, mentionType]) =>
        existingTypeByUserId.get(userId) !== mentionType
    )
    .map(([mentionedUserId, mentionType]) => ({
      messageId: input.messageId,
      channelId: input.channel.id,
      mentionedUserId,
      mentionType,
    }))
  if (addedRows.length > 0) {
    await db
      .insert(schema.messageMention)
      .values(addedRows)
      .onConflictDoNothing()
  }

  return listMentionUsers(mentionTypeByUserId)
}

export type NotificationPreviewMention = {
  id: string
  name: string
}

const NOTIFICATION_PREVIEW_MAX_LENGTH = 100

// Plain-text preview for notification surfaces (desktop notifications, push).
// Mention/citation/markdown handling mirrors apps/web/src/lib/search-preview.ts.
export function buildNotificationContentPreview(input: {
  content: string
  mentions?: readonly NotificationPreviewMention[]
  maxLength?: number
}) {
  const userById = new Map(
    (input.mentions ?? []).map((user) => [user.id, user])
  )
  const mentionLabel = (id: string) => {
    const user = userById.get(id)
    return `@${user ? user.name : "unknown-user"}`
  }

  const normalized = input.content
    .replace(MARKDOWN_USER_MENTION_REGEX, (_match, id: string) =>
      mentionLabel(id)
    )
    .replace(USER_MENTION_REGEX, (_match, id: string) => mentionLabel(id))
    .replace(/\[\[([^\]]+)\]\]/g, (_match, raw: string) => {
      const token = raw.trim()
      if (token.startsWith("msg:")) return "↗ message"
      if (token.startsWith("src:")) {
        const [, title = ""] = token.slice(4).split("|")
        return `↗ ${title.trim() || "source"}`
      }
      if (token.startsWith("call:")) {
        const [, channel = ""] = token.slice(5).split("|")
        return `↗ ${channel.trim() ? `${channel.trim()} call` : "call"}`
      }
      return token
    })
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^```[^\n]*$/gm, "")
    .replace(/(^|\n)[ \t]{0,3}(?:#{1,6}|>+|[-*+]|\d+[.)])[ \t]+/g, "$1")
    .replace(/(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/g, "$2")
    .replace(/\*(\S(?:[^*\n]*?\S)?)\*/g, "$1")
    .replace(/(^|\W)_(\S(?:[^_\n]*?\S)?)_(?=\W|$)/g, "$1$2")
    .replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim()

  const maxLength = input.maxLength ?? NOTIFICATION_PREVIEW_MAX_LENGTH
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}…`
}

async function buildResolvedNotificationContentPreview(content: string) {
  const mentionIds = [...extractDirectMentionUserIds(content)]
  const mentions =
    mentionIds.length > 0
      ? await db
          .select({
            id: schema.user.id,
            name: schema.user.name,
          })
          .from(schema.user)
          .where(inArray(schema.user.id, mentionIds))
      : []
  return buildNotificationContentPreview({ content, mentions })
}

// Embed titles/descriptions/fields are connector-supplied and unbounded, so
// stop reading once there is enough raw text to fill the preview instead of
// flattening and markdown-normalizing a whole payload for 100 characters.
// Markdown stripping only shrinks text, so a few budgets' worth always suffices.
const EMBED_PREVIEW_SCAN_BUDGET = NOTIFICATION_PREVIEW_MAX_LENGTH * 4

function buildNotificationEmbedPreview(embeds: readonly Embed[] | undefined) {
  const parts: string[] = []
  let remaining = EMBED_PREVIEW_SCAN_BUDGET
  for (const embed of embeds ?? []) {
    const texts = [
      embed.title,
      embed.description,
      ...(embed.fields ?? []).flatMap((field) => [field.name, field.value]),
    ]
    for (const text of texts) {
      if (remaining <= 0) break
      if (!text?.trim()) continue
      const slice = text.slice(0, remaining)
      parts.push(slice)
      remaining -= slice.length
    }
    if (remaining <= 0) break
  }

  return parts.length > 0
    ? buildNotificationContentPreview({ content: parts.join("\n") })
    : ""
}

export function buildReactionNotification(input: {
  channel: {
    id: string
    workspaceId: string | null
    name: string | null
    workspaceName?: string | null
  }
  message: {
    id: string
    threadRootId?: string | null
    content: string | null
    mentions?: readonly NotificationPreviewMention[]
  }
  actor: { id: string; name: string; image?: string | null }
  emoji: string
}): ReactionNotification {
  const contentPreview = input.message.content
    ? buildNotificationContentPreview({
        content: input.message.content,
        mentions: input.message.mentions,
      })
    : ""
  const messagePreview = contentPreview || null

  return {
    channelId: input.channel.id,
    workspaceId: input.channel.workspaceId,
    messageId: input.message.id,
    threadRootId: input.message.threadRootId ?? null,
    emoji: input.emoji,
    actorUserId: input.actor.id,
    actorName: input.actor.name,
    actorImage: input.actor.image ?? null,
    channelName: input.channel.name,
    workspaceName: input.channel.workspaceName ?? null,
    messagePreview,
  }
}

export async function buildMessageFanout(input: MessageFanoutInput) {
  const { audience, userIds: allRecipientIds } = await listRecipientAudience(
    input.channel
  )
  const recipientIds = [...new Set(allRecipientIds)].filter(
    (id) => id !== input.authorId
  )
  const threadRootId = input.message.threadRootId ?? null
  const [threadContext, callMemberIds] = await Promise.all([
    resolveThreadNotificationContext(input.message),
    threadRootId ? liveSessionChatMembers(threadRootId) : null,
  ])
  // Live session chat: only people in the call receive the message. Anyone
  // else it mentions learns who and where, never the content.
  const readerIds = callMemberIds
    ? recipientIds.filter((id) => callMemberIds.has(id))
    : recipientIds
  const outsideCall = (userId: string) =>
    callMemberIds !== null && !callMemberIds.has(userId)

  const contentPreview =
    (input.message.content
      ? await buildResolvedNotificationContentPreview(input.message.content)
      : "") ||
    buildNotificationEmbedPreview(input.message.embeds) ||
    (input.message.attachments.length > 0
      ? `sent ${input.message.attachments.length} attachment${input.message.attachments.length > 1 ? "s" : ""}`
      : null)

  const unreadPayload = (userId: string): UnreadNotification => ({
    channelId: input.channel.id,
    workspaceId: input.channel.workspaceId,
    messageId: input.message.id,
    messageType: input.message.type,
    threadRootId: threadContext.threadRootId,
    isLorThread: threadContext.isLorThread,
    isSubscribedToThread: threadContext.subscribedUserIds.has(userId),
    unreadCountDelta: 1,
    authorUserId: input.authorId,
    authorName: input.message.author.name,
    authorImage: input.message.author.image ?? null,
    contentPreview,
    channelName: input.channel.name,
    workspaceName: input.channel.workspaceName ?? null,
  })
  const unreadNotifications: Array<UserTargetedPayload<UnreadNotification>> =
    readerIds.map((userId) => ({ userId, payload: unreadPayload(userId) }))

  const onlineRecipientIds = needsPresenceLookup(
    audience,
    input.message.content ?? ""
  )
    ? await listOnlineRecipientIds(input.redis, readerIds)
    : new Set<string>()
  const mentionTypeByUserId = buildMentionTargets({
    audience,
    recipients: recipientIds,
    broadcastRecipients: readerIds,
    messageContent: input.message.content ?? "",
    onlineRecipientIds,
  })

  const messageMentions = await listMentionUsers(mentionTypeByUserId)

  // A direct mention in a thread subscribes the person to it; this covers
  // people's and Lor's messages alike. Broadcasts (@here) never subscribe.
  if (threadRootId) {
    await subscribeToThread(
      threadRootId,
      [...mentionTypeByUserId]
        .filter(([, mentionType]) => mentionType === "direct")
        .map(([userId]) => userId)
    )
  }

  if (mentionTypeByUserId.size === 0) {
    return {
      unreadNotifications,
      messageMentions,
      mentionNotifications: [] as Array<
        UserTargetedPayload<MentionNotification>
      >,
      callMentionPushes: [] as Array<UserTargetedPayload<CallMentionPush>>,
    }
  }

  // Push-only entries for people mentioned from a call they aren't in; they
  // never count as unread, and never point at the message or its chat.
  const callMentionPushes: Array<UserTargetedPayload<CallMentionPush>> = [
    ...mentionTypeByUserId.keys(),
  ]
    .filter(outsideCall)
    .map((userId) => {
      const { messageId: _messageId, ...payload } = unreadPayload(userId)
      return {
        userId,
        payload: {
          ...payload,
          threadRootId: null,
          contentPreview: "Mentioned you in a call",
        },
      }
    })

  const mentionRows = Array.from(mentionTypeByUserId.entries()).map(
    ([userId, mentionType]) => ({
      messageId: input.message.id,
      channelId: input.channel.id,
      mentionedUserId: userId,
      mentionType,
    })
  )

  await db
    .insert(schema.messageMention)
    .values(mentionRows)
    .onConflictDoNothing()

  const notificationRows = Array.from(mentionTypeByUserId.entries()).map(
    ([userId, mentionType]) => ({
      userId,
      workspaceId: input.channel.workspaceId,
      channelId: input.channel.id,
      messageId: input.message.id,
      type: toNotificationType(mentionType),
    })
  )

  const insertedNotifications = await db
    .insert(schema.notificationEvent)
    .values(notificationRows)
    .onConflictDoNothing()
    .returning({
      id: schema.notificationEvent.id,
      userId: schema.notificationEvent.userId,
      type: schema.notificationEvent.type,
      messageId: schema.notificationEvent.messageId,
      channelId: schema.notificationEvent.channelId,
      workspaceId: schema.notificationEvent.workspaceId,
      createdAt: schema.notificationEvent.createdAt,
    })

  const expectedNotificationKey = (row: { userId: string; type: string }) =>
    `${row.userId}:${row.type}`

  const insertedKeys = new Set(
    insertedNotifications.map((row) => expectedNotificationKey(row))
  )
  const missingUserIds = notificationRows
    .filter((row) => !insertedKeys.has(expectedNotificationKey(row)))
    .map((row) => row.userId)

  let allNotifications = insertedNotifications

  if (missingUserIds.length > 0) {
    const existingNotifications = await db
      .select({
        id: schema.notificationEvent.id,
        userId: schema.notificationEvent.userId,
        type: schema.notificationEvent.type,
        messageId: schema.notificationEvent.messageId,
        channelId: schema.notificationEvent.channelId,
        workspaceId: schema.notificationEvent.workspaceId,
        createdAt: schema.notificationEvent.createdAt,
      })
      .from(schema.notificationEvent)
      .where(
        and(
          eq(schema.notificationEvent.messageId, input.message.id),
          inArray(schema.notificationEvent.userId, [
            ...new Set(missingUserIds),
          ]),
          inArray(schema.notificationEvent.type, mentionNotificationTypes)
        )
      )

    const expectedKeys = new Set(
      notificationRows.map((row) => expectedNotificationKey(row))
    )
    const mergedByKey = new Map<
      string,
      (typeof insertedNotifications)[number]
    >()

    for (const notification of insertedNotifications) {
      mergedByKey.set(expectedNotificationKey(notification), notification)
    }

    for (const notification of existingNotifications) {
      const key = expectedNotificationKey(notification)
      if (expectedKeys.has(key) && !mergedByKey.has(key)) {
        mergedByKey.set(key, notification)
      }
    }

    allNotifications = [...mergedByKey.values()]
  }

  const mentionNotifications: Array<UserTargetedPayload<MentionNotification>> =
    allNotifications.flatMap((notification) => {
      if (!isMentionNotificationType(notification.type)) {
        return []
      }

      const outsider = outsideCall(notification.userId)
      return [
        {
          userId: notification.userId,
          payload: {
            id: notification.id,
            type: notification.type,
            messageId: notification.messageId ?? input.message.id,
            channelId: notification.channelId ?? input.channel.id,
            workspaceId: notification.workspaceId ?? input.channel.workspaceId,
            threadRootId: outsider ? null : threadContext.threadRootId,
            isLorThread: threadContext.isLorThread,
            isSubscribedToThread: threadContext.subscribedUserIds.has(
              notification.userId
            ),
            createdAt: notification.createdAt.toISOString(),
            ...(outsider && {
              callMention: {
                authorName: input.message.author.name,
                channelName: input.channel.name,
              },
            }),
          },
        },
      ]
    })

  return {
    unreadNotifications,
    messageMentions,
    mentionNotifications,
    callMentionPushes,
  }
}

export * from "./push"
