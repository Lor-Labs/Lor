import { db, schema } from "@repo/db"
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

type PostBotMessageInput = {
  channel: { id: string; workspaceId: string | null; name: string | null }
  authorId: string
  content: string
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
  const inserted = await db
    .insert(schema.message)
    .values({
      channelId: input.channel.id,
      authorId: input.authorId,
      content: input.content,
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
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, input.authorId))
    .then((rows) => rows[0])
  if (!author) throw new Error(`Bot author user missing: ${input.authorId}`)

  const io = await getEmitter()

  // Fanout failure must not fail the post — the message row is persisted.
  let mentions: RealtimeMessage["mentions"] = []
  try {
    const fanout = await buildMessageFanout({
      authorId: input.authorId,
      channel: input.channel,
      message: {
        id: inserted.id,
        content: input.content,
        author: { name: input.overrideName ?? author.name },
        attachments: [],
      },
    })
    mentions = fanout.messageMentions
    for (const n of fanout.unreadNotifications) {
      io.to(userRoom(n.userId)).emit("notification:unread", n.payload)
    }
    for (const n of fanout.mentionNotifications) {
      io.to(userRoom(n.userId)).emit("notification:mention", n.payload)
    }
    const redis = await getRedisClient()
    void sendMessagePushNotifications({ fanout, redis }).catch((err) => {
      logger.error(
        { err, messageId: inserted.id },
        "Push notification send failed"
      )
    })
  } catch (err) {
    logger.error({ err, messageId: inserted.id }, "Bot message fanout failed")
  }

  const message: RealtimeMessage = {
    id: inserted.id,
    channelId: input.channel.id,
    content: input.content,
    type: "default",
    pinned: false,
    createdAt: inserted.createdAt.toISOString(),
    author,
    overrideName: input.overrideName ?? null,
    overrideAvatarUrl: input.overrideAvatarUrl ?? null,
    mentions,
    reactions: [],
    attachments: [],
    embeds: [],
    referencedMessage: null,
    threadRootId: null,
  }
  io.to(channelRoom(input.channel.id)).emit("message:created", message)

  return { id: inserted.id }
}
