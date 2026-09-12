import { db, eq, MERLIN_USER_ID, schema } from "@repo/db"
import type { ChannelEventPayload, ChannelEventType } from "@repo/db/schema"
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

type MerlinMessageDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: RedisClient
}

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

// Unread/mention/push fanout for an already-persisted Merlin message — used
// standalone when a placeholder gets its final content (archive synthesis).
// Best effort: returns resolved mentions, or [] when fanout failed.
export async function fanoutMerlinMessage(
  deps: MerlinMessageDeps,
  input: { channelId: string; messageId: string; content: string }
): Promise<RealtimeMessage["mentions"]> {
  try {
    const [channel, author] = await Promise.all([
      loadChannel(input.channelId),
      loadMerlinAuthor(),
    ])
    if (!channel || !author) throw new Error("Channel or Merlin user missing")
    const fanout = await buildMessageFanout({
      authorId: MERLIN_USER_ID,
      channel,
      message: {
        id: input.messageId,
        content: input.content,
        author: { name: author.name, image: author.image },
        attachments: [],
      },
      redis: deps.redis,
    })
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
        logger.error(
          { err, messageId: input.messageId },
          "Merlin post push failed"
        )
      }
    )
    return fanout.messageMentions
  } catch (err) {
    logger.error(
      { err, messageId: input.messageId },
      "Merlin post fanout failed"
    )
    return []
  }
}

// Post a channel message as Merlin, with normal unread/mention/push fanout —
// the worker-side counterpart of the API's postBotMessage. `silent` skips the
// fanout entirely (loop fire markers are decoration — they must not bump
// unread counts every fire on top of the run's real messages).
export async function postMerlinMessage(
  deps: MerlinMessageDeps,
  input: {
    channelId: string
    content: string
    type?:
      | "default"
      | "event"
      | "plan_card"
      | "loop_card"
      | "loop_fire"
      | "proposal_card"
    // Channel event kind + structured copy data (type "event" only).
    eventType?: ChannelEventType
    eventPayload?: ChannelEventPayload
    // Loop fire markers point at the loop's card message so clients resolve
    // the loop row (cardMessageId) for rich chip rendering.
    referencedMessageId?: string
    silent?: boolean
  }
): Promise<{ messageId: string }> {
  const author = await loadMerlinAuthor()
  if (!author) throw new Error("Merlin user missing")

  const inserted = await db
    .insert(schema.message)
    .values({
      channelId: input.channelId,
      authorId: MERLIN_USER_ID,
      content: input.content,
      type: input.type ?? "default",
      eventType: input.eventType ?? null,
      eventPayload: input.eventPayload ?? null,
      referencedMessageId: input.referencedMessageId ?? null,
      excludedFromMemory: input.type === "event",
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
    .then((rows) => rows[0])
  if (!inserted) throw new Error("Message insert returned no row")

  const mentions = input.silent
    ? []
    : await fanoutMerlinMessage(deps, {
        channelId: input.channelId,
        messageId: inserted.id,
        content: input.content,
      })

  const message: RealtimeMessage = {
    id: inserted.id,
    channelId: input.channelId,
    content: input.content,
    type: input.type ?? "default",
    eventType: input.eventType ?? null,
    eventPayload: input.eventPayload ?? null,
    pinned: false,
    createdAt: inserted.createdAt.toISOString(),
    author: { ...author, avatarColor: null },
    mentions,
    reactions: [],
    attachments: [],
    embeds: [],
    referencedMessage: input.referencedMessageId
      ? {
          // Minimal stub — clients only need the id to resolve the loop; the
          // chip renderer never shows a reply preview for fire markers.
          id: input.referencedMessageId,
          content: null,
          author: { ...author, avatarColor: null },
          overrideName: null,
          overrideAvatarUrl: null,
        }
      : null,
    threadRootId: null,
  }
  deps.emitter.to(channelRoom(input.channelId)).emit("message:created", message)
  return { messageId: inserted.id }
}
