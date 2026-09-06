import {
  and,
  count,
  db,
  eq,
  inArray,
  isUniqueViolation,
  schema,
} from "@repo/db"
import {
  buildReactionNotification,
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

type CreateMessageInput = {
  userId: string
  payload: SendMessagePayload
  accessibleChannel: AccessibleChannel
  // Internal: Merlin's placeholder lands as "pending"; everything else defaults
  // to "complete" via the column default.
  status?: RealtimeMessage["status"]
  // Internal: a task's card; normal sends derive reply/default.
  type?: "task_card"
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
      authorUsername: schema.user.username,
      authorDisplayUsername: schema.user.displayUsername,
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
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
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
      username: refMsg.authorUsername,
      displayUsername: refMsg.authorDisplayUsername,
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
      referencedMessageId: schema.message.referencedMessageId,
      attachments: schema.message.attachments,
      embeds: schema.message.embeds,
      pinned: schema.message.pinned,
      authorId: schema.user.id,
      authorName: schema.user.name,
      authorUsername: schema.user.username,
      authorDisplayUsername: schema.user.displayUsername,
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
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
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
      username: row.authorUsername,
      displayUsername: row.authorDisplayUsername,
      image: row.authorImage,
      avatarColor: await workspaceAvatarColor(args.workspaceId, row.authorId),
    },
    mentions,
    reactions: [],
    attachments: row.attachments ?? [],
    embeds: row.embeds ?? [],
    referencedMessage: row.referencedMessageId
      ? await loadReferencedMessage(row.referencedMessageId, args.workspaceId)
      : null,
    threadRootId: row.threadRootId,
    nonce: args.clientKey,
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

export async function createMessage(input: CreateMessageInput) {
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

  let hasReply = !!input.payload.referencedMessageId
  const threadRootId: string | null = input.payload.threadRootId ?? null

  const runInsertTransaction = () =>
    db.transaction(async (tx) => {
      // Verify the referenced message exists in the same channel AND in the
      // same thread context (or both at channel level). Prevents a thread
      // reply from quoting a message in a different thread.
      if (hasReply && input.payload.referencedMessageId) {
        const ref = await tx
          .select({
            id: schema.message.id,
            threadRootId: schema.message.threadRootId,
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
        }
      }

      // Verify the thread root exists, is in this channel, and is itself a
      // channel-level message (threads are flat — replies can't host nested threads).
      if (threadRootId) {
        const root = await tx
          .select({
            id: schema.message.id,
            threadRootId: schema.message.threadRootId,
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

        if (!root || root.threadRootId !== null) {
          throw new Error("Invalid thread root")
        }
      }

      const insertedMessage = await tx
        .insert(schema.message)
        .values({
          channelId: input.payload.channelId,
          authorId: input.userId,
          content: input.payload.content ?? null,
          type: input.type ?? (hasReply ? "reply" : "default"),
          referencedMessageId: hasReply
            ? (input.payload.referencedMessageId ?? null)
            : null,
          threadRootId,
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
          createdAt: schema.message.createdAt,
          authorId: schema.user.id,
          authorName: schema.user.name,
          authorUsername: schema.user.username,
          authorDisplayUsername: schema.user.displayUsername,
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

      return createdMessageWithAuthor
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
      username: messageWithAuthor.authorUsername,
      displayUsername: messageWithAuthor.authorDisplayUsername,
      image: messageWithAuthor.authorImage,
      avatarColor: authorAvatarColor,
    },
    mentions: [],
    reactions: [],
    attachments: input.payload.attachments ?? [],
    embeds: [],
    referencedMessage,
    threadRootId,
  }

  if (input.payload.nonce) {
    createdMessage.nonce = input.payload.nonce
  }

  return {
    message: createdMessage,
    channel: channelRecord,
  } satisfies CreateMessageResult
}

// Moved to @repo/messaging so the API/worker's server-side thread posts
// (scope-run resolutions, Merlin placeholders) emit the same summaries.
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

  if (!messageRecord) {
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

  if (!messageRecord) {
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

  if (!messageRecord) {
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
          username: schema.user.username,
          displayUsername: schema.user.displayUsername,
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
