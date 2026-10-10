import { db, eq, LOR_USER_ID, schema } from "@repo/db"
import { findAgentSessionByThreadRoot } from "@repo/db/queries/agent-sessions"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import type { RunTriggerContext } from "@repo/lor"
import { actRunBriefing, releaseActRunDeliveries } from "@repo/lor/act-runs"
import { createSession, toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type { LorRespondJobData } from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { postLorMessage } from "@/lib/lor-messages"
import { startScopeRun } from "@/lib/run-queue"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

type ActSessionDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: ReturnType<typeof createClient>
  respondQueue: Queue<LorRespondJobData>
}

// Each Act event starts its own session (reference/workspace-model.md,
// decision 1): the event is the first turn, and Lor answers it like any
// session turn. The person who connected the source follows it when they can
// see the channel; Lor mentions anyone else who should know.
export async function startActSession(
  deps: ActSessionDeps,
  input: {
    runId: string
    workspaceId: string
    channelId: string
    triggerId: string
    connectedById: string | null
    label: string
    payload: string
  }
): Promise<"started" | "failed"> {
  const audience = input.connectedById
    ? await listChannelAudienceUserIds(input.channelId)
    : []
  const subscriberIds =
    input.connectedById && audience.includes(input.connectedById)
      ? [input.connectedById]
      : []
  const session = await db.transaction((tx) =>
    createSession(tx, {
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      authorId: LOR_USER_ID,
      creatorId: null,
      origin: "trigger",
      title: input.label,
      triggerId: input.triggerId,
      subscriberIds,
    })
  )
  deps.emitter
    .to(channelRoom(input.channelId))
    .emit("session:updated", { session: toRealtimeAgentSession(session) })
  notifyWorkspaceActivity(input.workspaceId)

  const { messageId: eventId } = await postLorMessage(deps, {
    channelId: input.channelId,
    threadRootId: session.threadRootId,
    content: input.payload,
    type: "event",
    eventType: "trigger_run",
    eventPayload: { triggerId: input.triggerId, label: input.label },
    silent: true,
  })
  const started = await startScopeRun(
    deps,
    {
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      threadRootId: session.threadRootId,
      scopeKey: session.threadRootId,
      triggerMessageId: eventId,
      queuedRunId: input.runId,
    },
    {
      // The unwind deletes the run; its deliveries go back to the queue.
      onUnwind: async () => {
        await releaseActRunDeliveries(input.runId).catch(() => {})
      },
    }
  )
  if (started !== "started") {
    logger.warn(
      { runId: input.runId, sessionId: session.id, started },
      "Act session run did not start"
    )
    return "failed"
  }
  return "started"
}

// The trigger behind a run in an Act session, and whether this run answers
// the event (its trigger message is the session's trigger_run line).
export async function loadTriggerRun(
  threadRootId: string | null,
  triggerMessageId: string
): Promise<{
  triggerId: string
  context: RunTriggerContext
  isEvent: boolean
} | null> {
  if (!threadRootId) return null
  const session = await findAgentSessionByThreadRoot(threadRootId)
  if (!session?.triggerId) return null
  const [trigger, message] = await Promise.all([
    db
      .select({ actInstructions: schema.connectorTrigger.actInstructions })
      .from(schema.connectorTrigger)
      .where(eq(schema.connectorTrigger.id, session.triggerId))
      .then((rows) => rows[0] ?? null),
    db
      .select({ eventType: schema.message.eventType })
      .from(schema.message)
      .where(eq(schema.message.id, triggerMessageId))
      .then((rows) => rows[0] ?? null),
  ])
  if (!trigger) return null
  return {
    triggerId: session.triggerId,
    context: { instructions: trigger.actInstructions ?? "" },
    isEvent: message?.eventType === "trigger_run",
  }
}

// The event turn carries what earlier runs on the trigger concluded. It rides
// the turn, not the system prompt, so the session's later runs replay it
// unchanged from the run's saved context.
export async function briefActEvent<
  T extends { messageId: string; content: string },
>(
  turns: T[],
  input: {
    triggerId: string
    channelId: string
    runId: string
    eventMessageId: string
  }
): Promise<T[]> {
  const briefing = await actRunBriefing(input).catch((err) => {
    logger.warn({ err, runId: input.runId }, "Act briefing failed")
    return null
  })
  if (!briefing) return turns
  return turns.map((turn) =>
    turn.messageId === input.eventMessageId
      ? { ...turn, content: `${turn.content}\n\n${briefing}` }
      : turn
  )
}
