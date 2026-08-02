import { and, asc, db, eq, gt, inArray, schema, sql } from "@repo/db"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import { getEmitter } from "@/lib/bot-messages"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type { GetRunEventsRoute, StopRunRoute } from "@/routes/v1/runs/routes"

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

  const events = await db
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
    .limit(EVENT_LIMIT)

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
    },
    HttpStatusCodes.OK
  )
}

const STOPPED_MESSAGE = "⏹️ Stopped."

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

  if (
    run.state === "complete" ||
    run.state === "failed" ||
    run.state === "stopped"
  ) {
    return c.json(
      { success: false, message: "Run already finished" },
      HttpStatusCodes.CONFLICT
    )
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
        stopRequestedBy: currentUser.id,
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
      return c.json(
        { state: "stopped" as const, stopped: true },
        HttpStatusCodes.OK
      )
    }
    // Claimed between the read and the update — fall through to the flag.
  }

  // Working/finalizing: record the request; the lease holder honors it at
  // the next safe step boundary (or it no-ops if the answer already ended).
  const flagged = await db
    .update(schema.agentRun)
    .set({
      stopRequestedAt: sql`coalesce(${schema.agentRun.stopRequestedAt}, now())`,
      stopRequestedBy: currentUser.id,
    })
    .where(
      and(
        eq(schema.agentRun.id, run.id),
        inArray(schema.agentRun.state, ["working", "finalizing"])
      )
    )
    .returning({ state: schema.agentRun.state })
    .then((rows) => rows[0])

  if (!flagged) {
    return c.json(
      { success: false, message: "Run already finished" },
      HttpStatusCodes.CONFLICT
    )
  }
  return c.json({ state: flagged.state, stopped: false }, HttpStatusCodes.OK)
}
