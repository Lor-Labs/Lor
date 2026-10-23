import {
  and,
  count,
  db,
  eq,
  inArray,
  isUniqueViolation,
  schema,
} from "@repo/db"
import { LOR_USER_ID } from "@repo/db/constants"
import { findAgentSessionByThreadRoot } from "@repo/db/queries/agent-sessions"
import { canSeeSessionChat } from "@repo/db/queries/session-chat-access"
import { subscribeToThread } from "@repo/db/queries/thread-subscriptions"
import type { AgentSession, ForwardedMessage } from "@repo/db/schema"
import { type CreateSessionArgs, createSession } from "@repo/lor/agent-sessions"
import {
  buildReactionNotification,
  channelEventContent,
  type PresenceRedisClient,
  syncMessageMentions,
} from "@repo/messaging"
import type {
  DeleteMessagePayload,
  EditMessagePayload,
  ReactionNotification,
  RealtimeMessage,
  RealtimeMessageMention,
  RealtimeMessageReactionUpdated,
  SendMessagePayload,
  ToggleMessageReactionPayload,
} from "@repo/realtime-types"
import {
  type AccessibleChannel,
  assertUserCanAccessChannel,
} from "@/services/channel-access"
import { sessionMessageRunsLor } from "@/services/lor-routing"

type CreateMessageInput = {
  userId: string
  payload: SendMessagePayload
  accessibleChannel: AccessibleChannel
  // Internal: Lor's placeholder lands as "pending"; everything else defaults
  // to "complete" via the column default.
  status?: RealtimeMessage["status"]
  // Internal: a plan's card; normal sends derive reply/default.
  type?: "plan_card"
  // The message starts a Lor session and becomes its first message, under a
  // new anchor, instead of posting where it was sent.
  newSession?: NewSessionInput
}

export type NewSessionInput = Pick<
  CreateSessionArgs,
  | "id"
  | "threadRootId"
  | "origin"
  | "code"
  | "sourceSessionId"
  | "title"
  | "contextMessageIds"
  | "subscriberIds"
> & {
  // "Continue in Code": the source session's thread, which gets the event.
  sourceThreadRootId?: string
}

type DeleteMessageInput = {
  userId: string
  payload: DeleteMessagePayload
}

type EditMessageInput = {
  userId: string
  payload: EditMessagePayload
  // Presence lookup so an edit that adds/keeps @here recomputes its mention
  // rows against who is online (edits never re-notify either way).
  redis?: PresenceRedisClient
}

type ToggleMessageReactionInput = {
  userId: string
  userName: string
  userImage: string | null
  payload: ToggleMessageReactionPayload
}

export type CreateMessageResult = {
  message: RealtimeMessage
  channel: AccessibleChannel
  // True when the clientKey matched an already-persisted send (client retry
  // after a lost ack): the original row is returned and the caller must skip
  // fanout/broadcast/triggers — they already ran the first time.
  deduplicated?: boolean
  // Set when this send started a Lor session.
  session?: AgentSession
  // "Continue in Code": the event row posted in the source session.
  continuedEvent?: RealtimeMessage
}

async function loadReferencedMessage(
  referencedMessageId: string,
  workspaceId: string | null
): Promise<RealtimeMessage["referencedMessage"]> {
  const refMsg = await db
    .select({
      id: schema.message.id,
      content: schema.message.content,
      authorId: schema.user.id,
      authorName: schema.user.name,
      authorImage: schema.user.image,
      overrideName: schema.message.overrideName,
      overrideAvatarUrl: schema.message.overrideAvatarUrl,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(eq(schema.message.id, referencedMessageId))
    .limit(1)
    .then((rows) => rows[0])
  if (!refMsg) return null

  // Mentions inside the quoted content, so reply previews resolve stored
  // `<@uuid>` tokens to names on live sends too — not just after a refetch.
  const refMentions = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.messageMention)
    .innerJoin(
      schema.user,
      eq(schema.messageMention.mentionedUserId, schema.user.id)
    )
    .where(
      and(
        eq(schema.messageMention.messageId, refMsg.id),
        eq(schema.messageMention.mentionType, "direct")
      )
    )

  // One set-based lookup rather than workspaceAvatarColor per mention, which
  // would be a query each.
  const mentionColors = new Map<string, string | null>()
  if (workspaceId && refMentions.length > 0) {
    const colorRows = await db
      .select({
        userId: schema.workspaceMember.userId,
        avatarColor: schema.workspaceMember.avatarColor,
      })
      .from(schema.workspaceMember)
      .where(
        and(
          eq(schema.workspaceMember.workspaceId, workspaceId),
          inArray(
            schema.workspaceMember.userId,
            refMentions.map((mention) => mention.id)
          )
        )
      )
    for (const row of colorRows) {
      mentionColors.set(row.userId, row.avatarColor)
    }
  }

  return {
    id: refMsg.id,
    content: refMsg.content,
    author: {
      id: refMsg.authorId,
      name: refMsg.authorName,
      image: refMsg.authorImage,
      avatarColor: await workspaceAvatarColor(workspaceId, refMsg.authorId),
    },
    overrideName: refMsg.overrideName,
    overrideAvatarUrl: refMsg.overrideAvatarUrl,
    mentions: refMentions.map((mention) => ({
      ...mention,
      avatarColor: mentionColors.get(mention.id) ?? null,
    })),
  }
}

export async function loadMessageByClientKey(args: {
  authorId: string
  channelId: string
  clientKey: string
  workspaceId: string | null
}): Promise<RealtimeMessage | null> {
  const row = await db
    .select({
      id: schema.message.id,
      channelId: schema.message.channelId,
      content: schema.message.content,
      type: schema.message.type,
      status: schema.message.status,
      createdAt: schema.message.createdAt,
      editedAt: schema.message.editedAt,
      threadRootId: schema.message.threadRootId,
      routedToLor: schema.message.routedToLor,
      referencedMessageId: schema.message.referencedMessageId,
      forwarded: schema.message.forwarded,
      attachments: schema.message.attachments,
      embeds: schema.message.embeds,
      pinned: schema.message.pinned,
      authorId: schema.user.id,
      authorName: schema.user.name,
      authorImage: schema.user.image,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(
        eq(schema.message.authorId, args.authorId),
        eq(schema.message.channelId, args.channelId),
        eq(schema.message.clientKey, args.clientKey)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!row) return null

  const mentions = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.messageMention)
    .innerJoin(
      schema.user,
      eq(schema.messageMention.mentionedUserId, schema.user.id)
    )
    .where(
      and(
        eq(schema.messageMention.messageId, row.id),
        eq(schema.messageMention.mentionType, "direct")
      )
    )

  return {
    id: row.id,
    channelId: row.channelId,
    content: row.content,
    type: row.type,
    status: row.status,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    ...(row.editedAt ? { editedAt: row.editedAt.toISOString() } : {}),
    author: {
      id: row.authorId,
      name: row.authorName,
      image: row.authorImage,
      avatarColor: await workspaceAvatarColor(args.workspaceId, row.authorId),
    },
    mentions,
    reactions: [],
    attachments: row.attachments ?? [],
    embeds: row.embeds ?? [],
    // A forward renders from its snapshot, not the original.
    referencedMessage:
      row.referencedMessageId && !row.forwarded
        ? await loadReferencedMessage(row.referencedMessageId, args.workspaceId)
        : null,
    forwarded: row.forwarded,
    threadRootId: row.threadRootId,
    routedToLor: row.routedToLor,
    nonce: args.clientKey,
  }
}

// The original as it is now, for a forward. Null when it can't be forwarded
// here: today only a message in one of this channel's sessions goes to its
// chat (chat between channels comes later).
async function loadForwardSnapshot(
  sourceId: string,
  channel: AccessibleChannel
): Promise<ForwardedMessage | null> {
  const row = await db
    .select({
      id: schema.message.id,
      content: schema.message.content,
      type: schema.message.type,
      status: schema.message.status,
      createdAt: schema.message.createdAt,
      threadRootId: schema.message.threadRootId,
      authorId: schema.user.id,
      authorName: schema.user.name,
      authorImage: schema.user.image,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(
        eq(schema.message.id, sourceId),
        eq(schema.message.channelId, channel.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!row?.threadRootId || row.status !== "complete") return null
  if (row.type !== "default" && row.type !== "reply") return null
  const session = await findAgentSessionByThreadRoot(row.threadRootId)
  if (!session) return null
  const mentions = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.messageMention)
    .innerJoin(
      schema.user,
      eq(schema.messageMention.mentionedUserId, schema.user.id)
    )
    .where(
      and(
        eq(schema.messageMention.messageId, row.id),
        eq(schema.messageMention.mentionType, "direct")
      )
    )
  return {
    messageId: row.id,
    author: { id: row.authorId, name: row.authorName, image: row.authorImage },
    content: row.content,
    mentions,
    createdAt: row.createdAt.toISOString(),
    source: {
      channelId: channel.id,
      channelName: channel.name ?? null,
      sessionId: session.id,
      sessionTitle: session.title,
    },
  }
}

export type DeleteMessageResult = {
  channelId: string
  messageId: string
  threadRootId: string | null
  channel: AccessibleChannel
}

export type ToggleMessageReactionResult = {
  threadRootId: string | null
  update: RealtimeMessageReactionUpdated
  channel: AccessibleChannel
  notification: {
    authorUserId: string
    payload: ReactionNotification
  } | null
}

async function workspaceAvatarColor(
  workspaceId: string | null,
  userId: string
) {
  if (!workspaceId) return null
  return db
    .select({ avatarColor: schema.workspaceMember.avatarColor })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspaceId),
        eq(schema.workspaceMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0]?.avatarColor ?? null)
}

export async function createMessage(
  input: CreateMessageInput
): Promise<CreateMessageResult> {
  if (input.accessibleChannel.id !== input.payload.channelId) {
    throw new Error("Channel mismatch")
  }
  // Archived channels (e.g. an archived project's) are read-only.
  if (!input.accessibleChannel.canWrite) {
    // A retry (same nonce) of a send persisted before the channel was
    // archived must still ack as deduplicated, not error.
    if (input.payload.nonce) {
      const existing = await loadMessageByClientKey({
        authorId: input.userId,
        channelId: input.payload.channelId,
        clientKey: input.payload.nonce,
        workspaceId: input.accessibleChannel.workspaceId,
      })
      if (existing) {
        return {
          message: existing,
          channel: input.accessibleChannel,
          deduplicated: true,
        } satisfies CreateMessageResult
      }
    }
    throw new Error("This channel is archived")
  }

  const channelRecord = input.accessibleChannel
  const authorAvatarColor = await workspaceAvatarColor(
    channelRecord.workspaceId,
    input.userId
  )

  const threadRootId: string | null = input.payload.threadRootId ?? null
  // Forward: a chat post carrying a snapshot of the original, not a reply.
  const forwardSourceId =
    input.payload.forward && !threadRootId && !input.newSession
      ? (input.payload.referencedMessageId ?? null)
      : null
  if (input.payload.forward && !forwardSourceId) {
    throw new Error("A message can only be forwarded into the channel chat")
  }
  const forwarded = forwardSourceId
    ? await loadForwardSnapshot(forwardSourceId, input.accessibleChannel)
    : null
  if (forwardSourceId && !forwarded) {
    throw new Error("This message can't be forwarded")
  }
  // A session start carries its quoted message as context, not as a reply.
  let hasReply =
    !!input.payload.referencedMessageId && !input.newSession && !forwarded

  // Voice channels hold only session roots; people write in a session's chat,
  // and a live session's chat only while they're in the call.
  const isVoice = channelRecord.type === "voice"
  if (isVoice && !threadRootId) {
    throw new Error("Voice channels only take messages in a call's chat")
  }
  if (
    isVoice &&
    threadRootId &&
    !(await canSeeSessionChat(input.userId, threadRootId))
  ) {
    throw new Error("Invalid thread root")
  }
  const existingSession = threadRootId
    ? await findAgentSessionByThreadRoot(threadRootId)
    : null
  if (existingSession?.archivedAt) throw new Error("This session is archived")
  const isPersonInSession =
    Boolean(input.newSession || existingSession) && input.userId !== LOR_USER_ID

  const runInsertTransaction = () =>
    db.transaction(async (tx) => {
      // Verify the referenced message exists in the same channel AND in the
      // same thread context (or both at channel level). Prevents a thread
      // reply from quoting a message in a different thread.
      let replyAuthorId: string | null = null
      if (hasReply && input.payload.referencedMessageId) {
        const ref = await tx
          .select({
            id: schema.message.id,
            threadRootId: schema.message.threadRootId,
            authorId: schema.message.authorId,
          })
          .from(schema.message)
          .where(
            and(
              eq(schema.message.id, input.payload.referencedMessageId),
              eq(schema.message.channelId, input.payload.channelId)
            )
          )
          .limit(1)
          .then((rows) => rows[0])

        if (!ref) {
          hasReply = false
        } else {
          // Both must share the same effective thread scope (null === channel).
          // A thread reply can only quote messages from the same thread root;
          // a channel-level send can only quote channel-level messages.
          const refRoot = ref.threadRootId ?? ref.id
          if (threadRootId) {
            if (refRoot !== threadRootId) hasReply = false
          } else if (ref.threadRootId !== null) {
            hasReply = false
          }
          if (hasReply) replyAuthorId = ref.authorId
        }
      }

      // Verify the thread root exists, is in this channel, and is itself a
      // channel-level message (threads are flat — replies can't host nested threads).
      let threadStarterId: string | null = null
      if (threadRootId) {
        const root = await tx
          .select({
            id: schema.message.id,
            threadRootId: schema.message.threadRootId,
            type: schema.message.type,
            authorId: schema.message.authorId,
          })
          .from(schema.message)
          .where(
            and(
              eq(schema.message.id, threadRootId),
              eq(schema.message.channelId, input.payload.channelId)
            )
          )
          .limit(1)
          .then((rows) => rows[0])

        if (
          !root ||
          root.threadRootId !== null ||
          (isVoice && root.type !== "voice_session")
        ) {
          throw new Error("Invalid thread root")
        }
        // The first reply starts a thread, so the root's author started it.
        const [earlierReply] = await tx
          .select({ id: schema.message.id })
          .from(schema.message)
          .where(eq(schema.message.threadRootId, threadRootId))
          .limit(1)
        if (!earlierReply) threadStarterId = root.authorId
      }

      const session =
        input.newSession && channelRecord.workspaceId
          ? await createSession(tx, {
              ...input.newSession,
              workspaceId: channelRecord.workspaceId,
              channelId: input.payload.channelId,
              authorId: input.userId,
              creatorId: input.userId,
            })
          : null

      const routedToLor = isPersonInSession
        ? sessionMessageRunsLor({
            content: input.payload.content,
            toPeople: input.payload.toPeople,
            replyAuthorId,
            senderId: input.userId,
            startsSession: Boolean(input.newSession),
          })
        : null

      const insertedMessage = await tx
        .insert(schema.message)
        .values({
          channelId: input.payload.channelId,
          authorId: input.userId,
          content: input.payload.content ?? null,
          type:
            input.type ??
            (forwarded ? "forward" : hasReply ? "reply" : "default"),
          referencedMessageId:
            forwardSourceId ??
            (hasReply ? (input.payload.referencedMessageId ?? null) : null),
          forwarded,
          threadRootId: session?.threadRootId ?? threadRootId,
          routedToLor,
          attachments: input.payload.attachments ?? [],
          status: input.status,
          clientKey: input.payload.nonce ?? null,
        })
        .returning({
          id: schema.message.id,
        })
        .then((rows) => rows[0])

      if (!insertedMessage) {
        throw new Error("Failed to create message")
      }

      // Writing in a thread subscribes you (a new session already subscribed
      // its starter and the people it mentions).
      if (threadRootId) {
        await subscribeToThread(
          threadRootId,
          threadStarterId ? [input.userId, threadStarterId] : [input.userId],
          tx
        )
      }

      await tx
        .update(schema.channel)
        .set({ updatedAt: new Date() })
        .where(eq(schema.channel.id, input.payload.channelId))

      const createdMessageWithAuthor = await tx
        .select({
          id: schema.message.id,
          channelId: schema.message.channelId,
          content: schema.message.content,
          type: schema.message.type,
          status: schema.message.status,
          routedToLor: schema.message.routedToLor,
          createdAt: schema.message.createdAt,
          authorId: schema.user.id,
          authorName: schema.user.name,
          authorImage: schema.user.image,
        })
        .from(schema.message)
        .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
        .where(eq(schema.message.id, insertedMessage.id))
        .limit(1)
        .then((rows) => rows[0])

      if (!createdMessageWithAuthor) {
        throw new Error("Failed to fetch created message")
      }

      // "Continue in Code": a row in the source session says where the work
      // went, for its people and for Lor there. Nobody is subscribed by it.
      const sourceThreadRootId = input.newSession?.sourceThreadRootId
      const continuedEvent =
        session && sourceThreadRootId
          ? await tx
              .insert(schema.message)
              .values({
                channelId: input.payload.channelId,
                authorId: input.userId,
                type: "event",
                eventType: "session_continued",
                eventPayload: {
                  sessionId: session.id,
                  repoFullName: session.repoFullName,
                },
                content: channelEventContent({
                  eventType: "session_continued",
                  actorName: createdMessageWithAuthor.authorName,
                  repoFullName: session.repoFullName,
                  threadRootId: session.threadRootId,
                }),
                threadRootId: sourceThreadRootId,
                excludedFromMemory: true,
              })
              .returning()
              .then((rows) => rows[0])
          : undefined

      return { ...createdMessageWithAuthor, session, continuedEvent }
    })

  let messageWithAuthor: Awaited<ReturnType<typeof runInsertTransaction>>
  try {
    messageWithAuthor = await runInsertTransaction()
  } catch (err) {
    // Same author + channel + nonce already persisted: a client retry after
    // a lost ack. Return the original row; the caller skips fanout/triggers.
    if (input.payload.nonce && isUniqueViolation(err)) {
      const existing = await loadMessageByClientKey({
        authorId: input.userId,
        channelId: input.payload.channelId,
        clientKey: input.payload.nonce,
        workspaceId: channelRecord.workspaceId,
      })
      if (existing) {
        return {
          message: existing,
          channel: channelRecord,
          deduplicated: true,
        } satisfies CreateMessageResult
      }
    }
    throw err
  }

  const referencedMessage =
    hasReply && input.payload.referencedMessageId
      ? await loadReferencedMessage(
          input.payload.referencedMessageId,
          channelRecord.workspaceId
        )
      : null

  const createdMessage: RealtimeMessage = {
    id: messageWithAuthor.id,
    channelId: messageWithAuthor.channelId,
    content: messageWithAuthor.content,
    type: messageWithAuthor.type,
    status: messageWithAuthor.status,
    pinned: false,
    createdAt: messageWithAuthor.createdAt.toISOString(),
    author: {
      id: messageWithAuthor.authorId,
      name: messageWithAuthor.authorName,
      image: messageWithAuthor.authorImage,
      avatarColor: authorAvatarColor,
    },
    mentions: [],
    reactions: [],
    attachments: input.payload.attachments ?? [],
    embeds: [],
    referencedMessage,
    forwarded,
    threadRootId: messageWithAuthor.session?.threadRootId ?? threadRootId,
    routedToLor: messageWithAuthor.routedToLor,
  }

  if (input.payload.nonce) {
    createdMessage.nonce = input.payload.nonce
  }

  const event = messageWithAuthor.continuedEvent
  const continuedEvent: RealtimeMessage | undefined = event
    ? {
        id: event.id,
        channelId: event.channelId,
        content: event.content,
        type: "event",
        eventType: event.eventType,
        eventPayload: event.eventPayload,
        status: event.status,
        pinned: false,
        createdAt: event.createdAt.toISOString(),
        author: createdMessage.author,
        mentions: [],
        reactions: [],
        attachments: [],
        embeds: [],
        referencedMessage: null,
        forwarded: null,
        threadRootId: event.threadRootId,
        routedToLor: null,
      }
    : undefined

  return {
    message: createdMessage,
    channel: channelRecord,
    session: messageWithAuthor.session ?? undefined,
    ...(continuedEvent ? { continuedEvent } : {}),
  } satisfies CreateMessageResult
}

// Moved to @repo/messaging so the API/worker's server-side thread posts
// (scope-run resolutions, Lor placeholders) emit the same summaries.
export { loadThreadSummary } from "@repo/messaging"

export async function deleteMessage(
  input: DeleteMessageInput
): Promise<DeleteMessageResult> {
  const channelRecord = await assertUserCanAccessChannel(
    input.userId,
    input.payload.channelId
  )

  const messageRecord = await db
    .select({
      id: schema.message.id,
      authorId: schema.message.authorId,
      threadRootId: schema.message.threadRootId,
      type: schema.message.type,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.id, input.payload.messageId),
        eq(schema.message.channelId, input.payload.channelId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  // Deleting a session anchor would cascade away the whole session.
  if (!messageRecord || messageRecord.type === "agent_session") {
    throw new Error("Message not found")
  }

  if (messageRecord.authorId !== input.userId) {
    throw new Error("You can only delete your own messages")
  }

  await db
    .delete(schema.message)
    .where(eq(schema.message.id, input.payload.messageId))

  return {
    channelId: input.payload.channelId,
    messageId: input.payload.messageId,
    threadRootId: messageRecord.threadRootId,
    channel: channelRecord,
  }
}

export type EditMessageResult = {
  threadRootId: string | null
  channelId: string
  messageId: string
  content: string
  editedAt: string
  mentions: RealtimeMessageMention[]
  channel: AccessibleChannel
}

export async function editMessage(
  input: EditMessageInput
): Promise<EditMessageResult> {
  const channelRecord = await assertUserCanAccessChannel(
    input.userId,
    input.payload.channelId
  )
  if (!channelRecord.canWrite) {
    throw new Error("This channel is archived")
  }

  const messageRecord = await db
    .select({
      id: schema.message.id,
      authorId: schema.message.authorId,
      threadRootId: schema.message.threadRootId,
      type: schema.message.type,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.id, input.payload.messageId),
        eq(schema.message.channelId, input.payload.channelId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!messageRecord || messageRecord.type === "agent_session") {
    throw new Error("Message not found")
  }

  if (messageRecord.authorId !== input.userId) {
    throw new Error("You can only edit your own messages")
  }

  const editedAt = new Date()

  await db
    .update(schema.message)
    .set({ content: input.payload.content, editedAt })
    .where(eq(schema.message.id, input.payload.messageId))

  const mentions = await syncMessageMentions({
    authorId: messageRecord.authorId,
    channel: channelRecord,
    messageId: input.payload.messageId,
    threadRootId: messageRecord.threadRootId,
    content: input.payload.content,
    redis: input.redis,
  })

  return {
    threadRootId: messageRecord.threadRootId,
    channelId: input.payload.channelId,
    messageId: input.payload.messageId,
    content: input.payload.content,
    editedAt: editedAt.toISOString(),
    mentions,
    channel: channelRecord,
  }
}

export async function toggleMessageReaction(input: ToggleMessageReactionInput) {
  const channelRecord = await assertUserCanAccessChannel(
    input.userId,
    input.payload.channelId
  )
  if (!channelRecord.canWrite) {
    throw new Error("This channel is archived")
  }

  const messageRecord = await db
    .select({
      id: schema.message.id,
      authorId: schema.message.authorId,
      content: schema.message.content,
      threadRootId: schema.message.threadRootId,
      type: schema.message.type,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.id, input.payload.messageId),
        eq(schema.message.channelId, input.payload.channelId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!messageRecord || messageRecord.type === "agent_session") {
    throw new Error("Message not found")
  }

  const nextReactionState = await db.transaction(async (tx) => {
    const existingReaction = await tx
      .select({ id: schema.messageReaction.id })
      .from(schema.messageReaction)
      .where(
        and(
          eq(schema.messageReaction.messageId, input.payload.messageId),
          eq(schema.messageReaction.userId, input.userId),
          eq(schema.messageReaction.emoji, input.payload.emoji)
        )
      )
      .limit(1)
      .then((rows) => rows[0])

    if (existingReaction) {
      await tx
        .delete(schema.messageReaction)
        .where(eq(schema.messageReaction.id, existingReaction.id))
      return false
    }

    await tx.insert(schema.messageReaction).values({
      messageId: input.payload.messageId,
      userId: input.userId,
      emoji: input.payload.emoji,
    })
    return true
  })

  const reactionCount = await db
    .select({ total: count() })
    .from(schema.messageReaction)
    .where(
      and(
        eq(schema.messageReaction.messageId, input.payload.messageId),
        eq(schema.messageReaction.emoji, input.payload.emoji)
      )
    )
    .limit(1)
    .then((rows) => rows[0]?.total ?? 0)

  const shouldNotifyAuthor =
    nextReactionState && messageRecord.authorId !== input.userId
  const notificationMentions = shouldNotifyAuthor
    ? await db
        .select({
          id: schema.user.id,
          name: schema.user.name,
        })
        .from(schema.messageMention)
        .innerJoin(
          schema.user,
          eq(schema.messageMention.mentionedUserId, schema.user.id)
        )
        .where(
          and(
            eq(schema.messageMention.messageId, messageRecord.id),
            eq(schema.messageMention.mentionType, "direct")
          )
        )
    : []
  const notification = shouldNotifyAuthor
    ? {
        authorUserId: messageRecord.authorId,
        payload: buildReactionNotification({
          channel: channelRecord,
          message: {
            id: messageRecord.id,
            threadRootId: messageRecord.threadRootId,
            content: messageRecord.content,
            mentions: notificationMentions,
          },
          actor: {
            id: input.userId,
            name: input.userName,
            image: input.userImage,
          },
          emoji: input.payload.emoji,
        }),
      }
    : null

  return {
    threadRootId: messageRecord.threadRootId,
    update: {
      channelId: input.payload.channelId,
      messageId: input.payload.messageId,
      emoji: input.payload.emoji,
      count: reactionCount,
      actorUserId: input.userId,
      actorName: input.userName,
      reactedByActor: nextReactionState,
    },
    channel: channelRecord,
    notification,
  } satisfies ToggleMessageReactionResult
}
