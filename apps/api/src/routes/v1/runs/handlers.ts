import { and, asc, db, eq, gt, inArray, schema, sql } from "@repo/db"
import { AGENT_RUN_STOP_CHANNEL } from "@repo/realtime-types/queues"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import { getEmitter } from "@/lib/bot-messages"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { getRedisClient } from "@/lib/redis"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  GetRunEventsRoute,
  RemoveQueuedMessageRoute,
  SteerQueuedMessageRoute,
  StopRunRoute,
} from "@/routes/v1/runs/routes"

// Retention cleanup prunes terminal runs' events; a full replay is bounded by
// one run's answer, but cap defensively.
const EVENT_LIMIT = 10_000

export const getRunEvents: AppRouteHandler<GetRunEventsRoute> = async (c) => {
  const currentUser = c.var.user
  const { messageId } = c.req.valid("param")
  const { after } = c.req.valid("query")

  // Tenant guard: the run's channel must still belong to the run's workspace
  // (fail closed on drift) before the caller's channel access is checked.
  const run = await db
    .select({
      id: schema.agentRun.id,
      messageId: schema.agentRun.messageId,
      channelId: schema.agentRun.channelId,
      threadRootId: schema.agentRun.threadRootId,
      scopeKey: schema.agentRun.scopeKey,
      workspaceId: schema.agentRun.workspaceId,
      channelWorkspaceId: schema.channel.workspaceId,
      state: schema.agentRun.state,
      stopReason: schema.agentRun.stopReason,
    })
    .from(schema.agentRun)
    .innerJoin(schema.channel, eq(schema.agentRun.channelId, schema.channel.id))
    .where(eq(schema.agentRun.messageId, messageId))
    .limit(1)
    .then((rows) => rows[0])

  if (!run) {
    return c.json(
      { success: false, message: "Run not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (run.channelWorkspaceId !== run.workspaceId) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  const canAccess = await userCanAccessChannel(run.channelId, currentUser.id)
  if (!canAccess) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const [events, queue] = await Promise.all([
    db
      .select({
        seq: schema.agentRunEvent.seq,
        kind: schema.agentRunEvent.kind,
        payload: schema.agentRunEvent.payload,
      })
      .from(schema.agentRunEvent)
      .where(
        and(
          eq(schema.agentRunEvent.runId, run.id),
          ...(after !== undefined ? [gt(schema.agentRunEvent.seq, after)] : [])
        )
      )
      .orderBy(asc(schema.agentRunEvent.seq))
      .limit(EVENT_LIMIT),
    db
      .select({
        messageId: schema.agentRunQueue.messageId,
        senderId: schema.agentRunQueue.senderId,
      })
      .from(schema.agentRunQueue)
      .where(
        and(
          eq(schema.agentRunQueue.scopeKey, run.scopeKey),
          eq(schema.agentRunQueue.state, "queued")
        )
      )
      .orderBy(asc(schema.agentRunQueue.createdAt)),
  ])

  return c.json(
    {
      run: {
        id: run.id,
        messageId: run.messageId,
        channelId: run.channelId,
        threadRootId: run.threadRootId,
        state: run.state,
        stopReason: run.stopReason,
      },
      events,
      queue,
    },
    HttpStatusCodes.OK
  )
}

const STOPPED_MESSAGE = "⏹️ Stopped."

type StopTargetRun = {
  id: string
  messageId: string
  channelId: string
  threadRootId: string | null
  state: (typeof schema.agentRun.$inferSelect)["state"]
}

type StopOutcome = {
  state: (typeof schema.agentRun.$inferSelect)["state"]
  stopped: boolean
}

// Shared stop core (Stop button + queued-message steer). Null = the run was
// already terminal.
async function requestRunStop(
  run: StopTargetRun,
  requestedBy: string
): Promise<StopOutcome | null> {
  if (
    run.state === "complete" ||
    run.state === "failed" ||
    run.state === "stopped"
  ) {
    return null
  }

  // Never claimed: no lease holder will honor the request — settle it here
  // and clear the stuck placeholder.
  if (run.state === "queued") {
    const settled = await db
      .update(schema.agentRun)
      .set({
        state: "stopped",
        stopReason: "stopped_by_user",
        stopRequestedAt: new Date(),
        stopRequestedBy: requestedBy,
        finishedAt: new Date(),
      })
      .where(
        and(eq(schema.agentRun.id, run.id), eq(schema.agentRun.state, "queued"))
      )
      .returning({ id: schema.agentRun.id })
      .then((rows) => rows[0])
    if (settled) {
      await db
        .update(schema.message)
        .set({ content: STOPPED_MESSAGE, status: "complete" })
        .where(
          and(
            eq(schema.message.id, run.messageId),
            eq(schema.message.status, "pending")
          )
        )
        .catch(() => {})
      const emitter = await getEmitter()
      emitter
        .to(
          run.threadRootId
            ? threadRoom(run.threadRootId)
            : channelRoom(run.channelId)
        )
        .emit("message:stream", {
          channelId: run.channelId,
          threadRootId: run.threadRootId,
          messageId: run.messageId,
          delta: STOPPED_MESSAGE,
          done: true,
          status: "complete",
          replace: true,
          runId: run.id,
        })
      return { state: "stopped", stopped: true }
    }
    // Claimed between the read and the update — fall through to the flag.
  }

  // Working/finalizing: record the request durably, then signal the lease
  // holder to abort the in-flight model request immediately.
  const flagged = await db
    .update(schema.agentRun)
    .set({
      stopRequestedAt: sql`coalesce(${schema.agentRun.stopRequestedAt}, now())`,
      stopRequestedBy: requestedBy,
    })
    .where(
      and(
        eq(schema.agentRun.id, run.id),
        inArray(schema.agentRun.state, ["working", "finalizing"])
      )
    )
    .returning({ state: schema.agentRun.state })
    .then((rows) => rows[0])

  if (!flagged) return null
  // Fast path: best-effort — the flag above is the durable fallback.
  await getRedisClient()
    .then((redis) => redis.publish(AGENT_RUN_STOP_CHANNEL, run.id))
    .catch(() => {})
  return { state: flagged.state, stopped: false }
}

export const stopRun: AppRouteHandler<StopRunRoute> = async (c) => {
  const currentUser = c.var.user
  const { messageId } = c.req.valid("param")

  const run = await db
    .select({
      id: schema.agentRun.id,
      messageId: schema.agentRun.messageId,
      channelId: schema.agentRun.channelId,
      threadRootId: schema.agentRun.threadRootId,
      workspaceId: schema.agentRun.workspaceId,
      channelWorkspaceId: schema.channel.workspaceId,
      state: schema.agentRun.state,
    })
    .from(schema.agentRun)
    .innerJoin(schema.channel, eq(schema.agentRun.channelId, schema.channel.id))
    .where(eq(schema.agentRun.messageId, messageId))
    .limit(1)
    .then((rows) => rows[0])

  if (!run) {
    return c.json(
      { success: false, message: "Run not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (run.channelWorkspaceId !== run.workspaceId) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  const canAccess = await userCanAccessChannel(run.channelId, currentUser.id)
  if (!canAccess) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const outcome = await requestRunStop(run, currentUser.id)
  if (!outcome) {
    return c.json(
      { success: false, message: "Run already finished" },
      HttpStatusCodes.CONFLICT
    )
  }
  return c.json(outcome, HttpStatusCodes.OK)
}

// "Steer" on a queued message: stop the scope's active run immediately; the
// completion drain then starts the follow-up run whose snapshot covers the
// queued message — the reprompt needs no explicit seeding.
export const steerQueuedMessage: AppRouteHandler<
  SteerQueuedMessageRoute
> = async (c) => {
  const currentUser = c.var.user
  const { messageId } = c.req.valid("param")

  const row = await db
    .select({
      state: schema.agentRunQueue.state,
      scopeKey: schema.agentRunQueue.scopeKey,
      channelId: schema.agentRun.channelId,
      workspaceId: schema.agentRun.workspaceId,
      channelWorkspaceId: schema.channel.workspaceId,
    })
    .from(schema.agentRunQueue)
    .innerJoin(
      schema.agentRun,
      eq(schema.agentRunQueue.runId, schema.agentRun.id)
    )
    .innerJoin(schema.channel, eq(schema.agentRun.channelId, schema.channel.id))
    .where(eq(schema.agentRunQueue.messageId, messageId))
    .limit(1)
    .then((rows) => rows[0])

  if (!row) {
    return c.json(
      { success: false, message: "Queued message not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (row.channelWorkspaceId !== row.workspaceId) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  const canAccess = await userCanAccessChannel(row.channelId, currentUser.id)
  if (!canAccess) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  if (row.state !== "queued") {
    return c.json(
      { success: false, message: "Message is no longer queued" },
      HttpStatusCodes.CONFLICT
    )
  }

  // Jump the line: the drain pops promoted rows before arrival order, so
  // this message is what the follow-up run answers first.
  await db
    .update(schema.agentRunQueue)
    .set({ promotedAt: new Date() })
    .where(
      and(
        eq(schema.agentRunQueue.messageId, messageId),
        eq(schema.agentRunQueue.state, "queued")
      )
    )

  const active = await db
    .select({
      id: schema.agentRun.id,
      messageId: schema.agentRun.messageId,
      channelId: schema.agentRun.channelId,
      threadRootId: schema.agentRun.threadRootId,
      state: schema.agentRun.state,
    })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.scopeKey, row.scopeKey),
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  const outcome = active ? await requestRunStop(active, currentUser.id) : null
  if (!outcome) {
    // The run finished on its own between the read and the stop. The
    // promotion stands, so the drain answers this message next — steering
    // succeeded even though there was nothing left to stop.
    return c.json(
      { state: "complete" as const, stopped: false },
      HttpStatusCodes.OK
    )
  }
  return c.json(outcome, HttpStatusCodes.OK)
}

export const removeQueuedMessage: AppRouteHandler<
  RemoveQueuedMessageRoute
> = async (c) => {
  const currentUser = c.var.user
  const { messageId } = c.req.valid("param")

  const row = await db
    .select({
      id: schema.agentRunQueue.id,
      senderId: schema.agentRunQueue.senderId,
      state: schema.agentRunQueue.state,
      scopeKey: schema.agentRunQueue.scopeKey,
      channelId: schema.agentRun.channelId,
      workspaceId: schema.agentRun.workspaceId,
      channelWorkspaceId: schema.channel.workspaceId,
    })
    .from(schema.agentRunQueue)
    .innerJoin(
      schema.agentRun,
      eq(schema.agentRunQueue.runId, schema.agentRun.id)
    )
    .innerJoin(schema.channel, eq(schema.agentRun.channelId, schema.channel.id))
    .where(eq(schema.agentRunQueue.messageId, messageId))
    .limit(1)
    .then((rows) => rows[0])

  if (!row) {
    return c.json(
      { success: false, message: "Queued message not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (row.channelWorkspaceId !== row.workspaceId) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  const canAccess = await userCanAccessChannel(row.channelId, currentUser.id)
  if (!canAccess) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  if (row.senderId !== currentUser.id) {
    return c.json(
      { success: false, message: "Only the sender can withdraw a message" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const cancelled = await db
    .update(schema.agentRunQueue)
    .set({ state: "cancelled" })
    .where(
      and(
        eq(schema.agentRunQueue.id, row.id),
        eq(schema.agentRunQueue.state, "queued")
      )
    )
    .returning({ id: schema.agentRunQueue.id })
    .then((rows) => rows[0])

  if (!cancelled) {
    return c.json(
      { success: false, message: "Message was already picked up" },
      HttpStatusCodes.CONFLICT
    )
  }

  const threadRootId = row.scopeKey === row.channelId ? null : row.scopeKey
  const emitter = await getEmitter()
  emitter
    .to(threadRootId ? threadRoom(threadRootId) : channelRoom(row.channelId))
    .emit("run:queue:updated", {
      channelId: row.channelId,
      threadRootId,
      messageId,
      state: "cancelled",
    })
  return c.json({ removed: true }, HttpStatusCodes.OK)
}
