import { db, eq, MERLIN_USER_ID, schema } from "@repo/db"
import {
  buildMessageFanout,
  sendMessagePushNotifications,
} from "@repo/messaging"
import type { RealtimeMessage } from "@repo/realtime-types"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { channelRoom, userRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"

type RedisClient = ReturnType<typeof createClient>

export async function loadMerlinAuthor() {
  return db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, MERLIN_USER_ID))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function loadChannel(channelId: string) {
  return db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      name: schema.channel.name,
      workspaceName: schema.workspace.name,
    })
    .from(schema.channel)
    .leftJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.channel.workspaceId)
    )
    .where(eq(schema.channel.id, channelId))
    .then((rows) => rows[0] ?? null)
}

// Post a channel message as Merlin, with normal unread/mention/push fanout —
// the worker-side counterpart of the API's postBotMessage.
export async function postMerlinMessage(
  deps: { emitter: Emitter<ServerToClientEvents>; redis: RedisClient },
  input: {
    channelId: string
    content: string
    type?: "default" | "task_card"
  }
): Promise<{ messageId: string }> {
  const [channel, author] = await Promise.all([
    loadChannel(input.channelId),
    loadMerlinAuthor(),
  ])
  if (!channel || !author) throw new Error("Channel or Merlin user missing")

  const inserted = await db
    .insert(schema.message)
    .values({
      channelId: input.channelId,
      authorId: MERLIN_USER_ID,
      content: input.content,
      type: input.type ?? "default",
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
    .then((rows) => rows[0])
  if (!inserted) throw new Error("Message insert returned no row")

  let mentions: RealtimeMessage["mentions"] = []
  try {
    const fanout = await buildMessageFanout({
      authorId: MERLIN_USER_ID,
      channel,
      message: {
        id: inserted.id,
        content: input.content,
        author: { name: author.name, image: author.image },
        attachments: [],
      },
    })
    mentions = fanout.messageMentions
    for (const n of fanout.unreadNotifications) {
      deps.emitter.to(userRoom(n.userId)).emit("notification:unread", n.payload)
    }
    for (const n of fanout.mentionNotifications) {
      deps.emitter
        .to(userRoom(n.userId))
        .emit("notification:mention", n.payload)
    }
    void sendMessagePushNotifications({ fanout, redis: deps.redis }).catch(
      (err) => {
        logger.error({ err, messageId: inserted.id }, "Merlin post push failed")
      }
    )
  } catch (err) {
    logger.error({ err, messageId: inserted.id }, "Merlin post fanout failed")
  }

  const message: RealtimeMessage = {
    id: inserted.id,
    channelId: input.channelId,
    content: input.content,
    type: input.type ?? "default",
    pinned: false,
    createdAt: inserted.createdAt.toISOString(),
    author: { ...author, avatarColor: null },
    mentions,
    reactions: [],
    attachments: [],
    embeds: [],
    referencedMessage: null,
    threadRootId: null,
  }
  deps.emitter.to(channelRoom(input.channelId)).emit("message:created", message)
  return { messageId: inserted.id }
}
