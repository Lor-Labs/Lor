import { db, eq, LOR_USER_ID, schema, sql } from "@repo/db"
import type { ChannelEventPayload, ChannelEventType } from "@repo/db/schema"
import {
  buildMessageFanout,
  loadThreadSummary,
  sendMessagePushNotifications,
} from "@repo/messaging"
import type { RealtimeMessage } from "@repo/realtime-types"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { channelRoom, threadRoom, userRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"

type RedisClient = ReturnType<typeof createClient>

export type LorMessageDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: RedisClient
}

export async function loadLorAuthor() {
  return db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, LOR_USER_ID))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function loadChannel(channelId: string) {
  return db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      name: schema.channel.name,
      type: schema.channel.type,
      // The agent that answers in the channel: the first one added.
      agentName: sql<
        string | null
      >`(select a.name from channel_agent ca join agent a on a.id = ca.agent_id where ca.channel_id = ${schema.channel.id} order by ca.created_at, ca.agent_id limit 1)`,
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

// Lor in a text channel's chat or a human thread is the channel's agent, and
// notifications carry its name (reference/always-on-agents.md, decision 32).
// In a session thread it stays Lor.
async function speaksAsAgent(
  channel: { type: string },
  threadRootId: string | undefined
) {
  if (channel.type !== "text") return false
  if (!threadRootId) return true
  const [session] = await db
    .select({ id: schema.agentSession.id })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.threadRootId, threadRootId))
    .limit(1)
  return !session
}

// Unread/mention/push fanout for an already-persisted Lor message — used
// standalone when a placeholder gets its final content (archive synthesis).
// Best effort: returns resolved mentions, or [] when fanout failed.
export async function fanoutLorMessage(
  deps: LorMessageDeps,
  input: {
    channelId: string
    messageId: string
    content: string
    threadRootId?: string
    // The agent that wrote it; without one, the channel's first.
    agentId?: string
  }
): Promise<RealtimeMessage["mentions"]> {
  try {
    const [channel, author, writer] = await Promise.all([
      loadChannel(input.channelId),
      loadLorAuthor(),
      input.agentId
        ? db
            .select({ name: schema.agent.name })
            .from(schema.agent)
            .where(eq(schema.agent.id, input.agentId))
            .then((rows) => rows[0] ?? null)
        : null,
    ])
    if (!channel || !author) throw new Error("Channel or Lor user missing")
    const asAgent = await speaksAsAgent(channel, input.threadRootId).catch(
      (err) => {
        logger.warn(
          { err, messageId: input.messageId },
          "Lor post author lookup failed"
        )
        return false
      }
    )
    const fanout = await buildMessageFanout({
      authorId: LOR_USER_ID,
      channel,
      message: {
        id: input.messageId,
        content: input.content,
        author: {
          name: (asAgent && (writer?.name ?? channel.agentName)) || author.name,
          image: author.image,
        },
        attachments: [],
        threadRootId: input.threadRootId ?? null,
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
          "Lor post push failed"
        )
      }
    )
    return fanout.messageMentions
  } catch (err) {
    logger.error({ err, messageId: input.messageId }, "Lor post fanout failed")
    return []
  }
}

// Post a channel message as Lor, with normal unread/mention/push fanout —
// the worker-side counterpart of the API's postBotMessage. `silent` skips the
// fanout entirely (loop fire markers are decoration — they must not bump
// unread counts every fire on top of the run's real messages).
export async function postLorMessage(
  deps: LorMessageDeps,
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
      // The channel agent speaking in the channel chat (send_message).
      | "agent_post"
    // Channel event kind + structured copy data (type "event" only).
    eventType?: ChannelEventType
    eventPayload?: ChannelEventPayload
    // Loop fire markers point at the loop's card message so clients resolve
    // the loop row (cardMessageId) for rich chip rendering.
    referencedMessageId?: string
    // A reply in this thread rather than a channel message.
    threadRootId?: string
    silent?: boolean
    // A run's message: clients show the run's approval card under it.
    lorTriggerMessageId?: string
    // The agent speaking, in a chat: several agents post as Lor
    // (`message.agent_id`).
    agentId?: string
  }
): Promise<{ messageId: string }> {
  const author = await loadLorAuthor()
  if (!author) throw new Error("Lor user missing")

  const inserted = await db
    .insert(schema.message)
    .values({
      channelId: input.channelId,
      authorId: LOR_USER_ID,
      content: input.content,
      type: input.type ?? "default",
      eventType: input.eventType ?? null,
      eventPayload: input.eventPayload ?? null,
      referencedMessageId: input.referencedMessageId ?? null,
      threadRootId: input.threadRootId ?? null,
      agentId: input.agentId ?? null,
      excludedFromMemory: input.type === "event",
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
    .then((rows) => rows[0])
  if (!inserted) throw new Error("Message insert returned no row")

  const mentions = input.silent
    ? []
    : await fanoutLorMessage(deps, {
        channelId: input.channelId,
        messageId: inserted.id,
        content: input.content,
        ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
        ...(input.agentId ? { agentId: input.agentId } : {}),
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
    threadRootId: input.threadRootId ?? null,
    agentId: input.agentId ?? null,
    ...(input.lorTriggerMessageId
      ? { lorTriggerMessageId: input.lorTriggerMessageId }
      : {}),
  }
  if (!input.threadRootId) {
    deps.emitter
      .to(channelRoom(input.channelId))
      .emit("message:created", message)
    return { messageId: inserted.id }
  }
  // A reply reaches the thread's room; the channel feed learns of it through
  // the thread summary (reply count, latest repliers).
  deps.emitter
    .to(threadRoom(input.threadRootId))
    .emit("message:created", message)
  await loadThreadSummary(input.channelId, input.threadRootId)
    .then((summary) =>
      deps.emitter
        .to(channelRoom(input.channelId))
        .emit("message:thread:updated", summary)
    )
    .catch((err) =>
      logger.warn({ err, messageId: inserted.id }, "Thread summary emit failed")
    )
  return { messageId: inserted.id }
}
