import { db, schema } from "@repo/db"
import type {
  ChannelEventPayload,
  ChannelEventType,
  Embed,
} from "@repo/db/schema"
import {
  buildMessageFanout,
  sendMessagePushNotifications,
} from "@repo/messaging"
import {
  channelRoom,
  type RealtimeMessage,
  type ServerToClientEvents,
  userRoom,
} from "@repo/realtime-types"
import { Emitter } from "@socket.io/redis-emitter"
import { eq } from "drizzle-orm"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"

let emitter: Emitter<ServerToClientEvents> | null = null

export async function getEmitter() {
  const redis = await getRedisClient()
  if (!emitter) {
    emitter = new Emitter<ServerToClientEvents>(redis)
  }
  return emitter
}

// Await publishes when the caller needs emit failures in its own error path.
export async function publishRealtime(
  emit: (io: Emitter<ServerToClientEvents>) => void
) {
  const redis = await getRedisClient()
  const publishes: Promise<number>[] = []
  const io = new Emitter<ServerToClientEvents>({
    publish(channel: string, message: string | Buffer) {
      const result = redis.publish(channel, message)
      publishes.push(result)
      return result
    },
  })
  try {
    emit(io)
  } finally {
    await Promise.all(publishes)
  }
}

type PostBotMessageInput = {
  channel: {
    id: string
    workspaceId: string | null
    name: string | null
    workspaceName?: string | null
  }
  authorId: string
  content: string
  type?: "default" | "event"
  eventType?: ChannelEventType
  eventPayload?: ChannelEventPayload
  // Skips unread/mention/push fanout entirely — the row still broadcasts
  // message:created to the channel room. Channel events post silent so they
  // don't bump unreads (loop_fire precedent).
  silent?: boolean
  // Structured cards (webhook embeds/attachments); rendered by the clients.
  embeds?: Embed[]
  overrideName?: string
  overrideAvatarUrl?: string
  excludedFromMemory?: boolean
}

// Insert + broadcast a bot-authored channel message (webhook executions,
// connector notifications) — the API-side counterpart of the realtime
// server's createMessage, without a socket.
export async function postBotMessage(
  input: PostBotMessageInput
): Promise<{ id: string }> {
  // Archived channels (e.g. an archived project's) are read-only for bots
  // and webhooks too, not just users.
  const target = await db
    .select({ archivedAt: schema.channel.archivedAt })
    .from(schema.channel)
    .where(eq(schema.channel.id, input.channel.id))
    .limit(1)
    .then((rows) => rows[0])
  if (!target) throw new Error("Channel not found")
  if (target.archivedAt) throw new Error("This channel is archived")

  const inserted = await db
    .insert(schema.message)
    .values({
      channelId: input.channel.id,
      authorId: input.authorId,
      content: input.content,
      type: input.type ?? "default",
      eventType: input.eventType ?? null,
      eventPayload: input.eventPayload ?? null,
      embeds: input.embeds ?? [],
      overrideName: input.overrideName ?? null,
      overrideAvatarUrl: input.overrideAvatarUrl ?? null,
      excludedFromMemory: input.excludedFromMemory ?? false,
    })
    .returning({
      id: schema.message.id,
      createdAt: schema.message.createdAt,
    })
    .then((rows) => rows[0])
  if (!inserted) throw new Error("Bot message insert returned no row")

  const author = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, input.authorId))
    .then((rows) => rows[0])
  if (!author) throw new Error(`Bot author user missing: ${input.authorId}`)

  const io = await getEmitter()

  // Fanout failure must not fail the post — the message row is persisted.
  // Silent posts skip fanout entirely; the channel-room broadcast still runs.
  let mentions: RealtimeMessage["mentions"] = []
  if (!input.silent) {
    try {
      const workspaceName =
        input.channel.workspaceName ??
        (input.channel.workspaceId
          ? await db
              .select({ name: schema.workspace.name })
              .from(schema.workspace)
              .where(eq(schema.workspace.id, input.channel.workspaceId))
              .limit(1)
              .then((rows) => rows[0]?.name ?? null)
          : null)
      const redis = await getRedisClient()
      const fanout = await buildMessageFanout({
        authorId: input.authorId,
        channel: { ...input.channel, workspaceName },
        message: {
          id: inserted.id,
          type: input.type ?? "default",
          content: input.content,
          author: {
            name: input.overrideName ?? author.name,
            image: input.overrideAvatarUrl ?? author.image,
          },
          attachments: [],
          embeds: input.embeds,
        },
        redis,
      })
      mentions = fanout.messageMentions
      for (const n of fanout.unreadNotifications) {
        io.to(userRoom(n.userId)).emit("notification:unread", n.payload)
      }
      for (const n of fanout.mentionNotifications) {
        io.to(userRoom(n.userId)).emit("notification:mention", n.payload)
      }
      void sendMessagePushNotifications({ fanout, redis }).catch((err) => {
        logger.error(
          { err, messageId: inserted.id },
          "Push notification send failed"
        )
      })
    } catch (err) {
      logger.error({ err, messageId: inserted.id }, "Bot message fanout failed")
    }
  }

  const message: RealtimeMessage = {
    id: inserted.id,
    channelId: input.channel.id,
    content: input.content,
    type: input.type ?? "default",
    eventType: input.eventType ?? null,
    eventPayload: input.eventPayload ?? null,
    pinned: false,
    createdAt: inserted.createdAt.toISOString(),
    author,
    overrideName: input.overrideName ?? null,
    overrideAvatarUrl: input.overrideAvatarUrl ?? null,
    mentions,
    reactions: [],
    attachments: [],
    embeds: input.embeds ?? [],
    referencedMessage: null,
    threadRootId: null,
  }
  io.to(channelRoom(input.channel.id)).emit("message:created", message)

  return { id: inserted.id }
}
