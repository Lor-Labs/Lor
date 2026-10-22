import {
  and,
  asc,
  db,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  schema,
  sql,
} from "@repo/db"
import type { AgentRunContextUsage } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { settleAbandonedRunPlan } from "@repo/lor/plans"
import { AGENT_RUN_STOP_CHANNEL } from "@repo/realtime-types/queues"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import { stopPausedTurn } from "@/lib/approvals"
import { getEmitter } from "@/lib/bot-messages"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { getRedisClient } from "@/lib/redis"
import { emitPlanUpdated } from "@/lib/scope-runs"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"
import type {
  GetRunEventsRoute,
  GetThreadContextRoute,
  RemoveQueuedMessageRoute,
  SteerQueuedMessageRoute,
  StopRunRoute,
} from "@/routes/v1/runs/routes"

// Page durable events so long runs can be recovered without silent truncation.
const EVENT_LIMIT = 10_000

export const getRunEvents: AppRouteHandler<GetRunEventsRoute> = async (c) => {
  const currentUser = c.var.user
  const { messageId } = c.req.valid("param")
  const { after } = c.req.valid("query")

  // Tenant guard: the run's channel must still belong to the run's workspace
  // (fail closed on drift) before the caller's channel access is checked.
  // Looked up BY messageId, so the param is the run's (non-null) message id.
  const run = await db
    .select({
      id: schema.agentRun.id,
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
      .limit(EVENT_LIMIT + 1),
    db
      .select({
        messageId: schema.agentRunQueue.messageId,
        senderId: schema.agentRunQueue.senderId,
      })
      .from(schema.agentRunQueue)
      .where(
        and(
          eq(schema.agentRunQueue.scopeKey, run.scopeKey),
          eq(schema.agentRunQueue.state, "queued"),
          // An approval resume waits on Lor's own reply, not a person's
          // message, so it never shows in the queue.
          isNull(schema.agentRunQueue.resumeApprovalId)
        )
      )
      .orderBy(asc(schema.agentRunQueue.createdAt)),
  ])

  return c.json(
    {
      run: {
        id: run.id,
        messageId,
        channelId: run.channelId,
        threadRootId: run.threadRootId,
        state: run.state,
        stopReason: run.stopReason,
      },
      events: events.slice(0, EVENT_LIMIT),
      nextCursor:
        events.length > EVENT_LIMIT
          ? (events[EVENT_LIMIT - 1]?.seq ?? null)
          : null,
      queue,
    },
    HttpStatusCodes.OK
  )
}

// UTF-8 bytes over 3, a conservative estimate for the prompt and tool
// segments and the uncompacted history; Pi gives the total.
const BYTES_PER_TOKEN = 3
const EMPTY_CONTEXT = {
  available: false as const,
  usedTokens: 0,
  windowTokens: env.LOR_CONTEXT_WINDOW,
  compactAtTokens: env.LOR_COMPACT_INPUT_TOKENS,
  segments: { system: 0, tools: 0, messages: 0 },
  compacted: false,
  rawHistoryTokens: 0,
  creditsSpent: 0,
  runCount: 0,
  state: null,
}

export const getThreadContext: AppRouteHandler<GetThreadContextRoute> = async (
  c
) => {
  const currentUser = c.var.user
  const { scopeKey } = c.req.valid("param")

  // Newest run in the scope whose turn saved Pi's context count. A run still
  // working shows the count its predecessor left, which is what this turn
  // started from.
  const contextUsage = sql<AgentRunContextUsage | null>`${schema.agentRun.context} -> 'contextUsage'`
  const run = await db
    .select({
      id: schema.agentRun.id,
      channelId: schema.agentRun.channelId,
      workspaceId: schema.agentRun.workspaceId,
      channelWorkspaceId: schema.channel.workspaceId,
      state: schema.agentRun.state,
      contextUsage,
      instructionsBytes: sql<number>`coalesce(octet_length(${schema.agentRun.instructions}), 0)`,
      // Read the one field out in SQL rather than shipping the whole snapshot.
      toolSchemaBytes: sql<number>`coalesce((${schema.agentRun.context} ->> 'toolSchemaBytes')::int, 0)`,
    })
    .from(schema.agentRun)
    .innerJoin(schema.channel, eq(schema.agentRun.channelId, schema.channel.id))
    .where(and(eq(schema.agentRun.scopeKey, scopeKey), isNotNull(contextUsage)))
    .orderBy(desc(schema.agentRun.createdAt))
    .limit(1)
    .then((rows) => rows[0])

  // "No run here" and "not yours to see" return the identical unavailable
  // payload on purpose. Distinguishing them (200 vs 403) would let any signed-in
  // caller probe a scope id and learn whether a run exists in a workspace they
  // have no access to. The meter hides itself either way, so the caller loses
  // nothing. Workspace drift on the run's channel fails closed into the same
  // response.
  const usage = run?.contextUsage
  if (!(run && usage)) return c.json(EMPTY_CONTEXT, HttpStatusCodes.OK)
  const visible =
    run.channelWorkspaceId === run.workspaceId &&
    (await userCanAccessChannel(run.channelId, currentUser.id))
  if (!visible) return c.json(EMPTY_CONTEXT, HttpStatusCodes.OK)

  const [scope, history] = await Promise.all([
    db
      .select({
        creditsSpent: sql<number>`coalesce(sum(${schema.agentRun.creditsSpent}), 0)`,
        runCount: sql<number>`count(*)`,
        state: sql<
          typeof schema.agentRun.$inferSelect.state
        >`(array_agg(${schema.agentRun.state} order by ${schema.agentRun.createdAt} desc))[1]`,
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.scopeKey, scopeKey))
      .then((rows) => rows[0]),
    // The whole saved Pi log: what a request would weigh with no compaction.
    // The scope is a session's thread or a call.
    db
      .select({ byteLength: schema.harnessState.byteLength })
      .from(schema.harnessState)
      .leftJoin(
        schema.agentSession,
        eq(schema.harnessState.sessionId, schema.agentSession.id)
      )
      .where(
        or(
          eq(schema.agentSession.threadRootId, scopeKey),
          eq(schema.harnessState.voiceSessionId, scopeKey)
        )
      )
      .limit(1)
      .then((rows) => rows[0]),
  ])

  const toTokens = (bytes: number) => Math.ceil(Number(bytes) / BYTES_PER_TOKEN)
  const system = toTokens(run.instructionsBytes)
  const tools = toTokens(run.toolSchemaBytes)
  // Null right after a compaction until the next model response: only the
  // prompt and tools are known then.
  const usedTokens = usage.tokens ?? system + tools
  const systemTokens = Math.min(system, usedTokens)
  const toolTokens = Math.min(tools, usedTokens - systemTokens)

  return c.json(
    {
      available: true,
      usedTokens,
      windowTokens: usage.windowTokens,
      compactAtTokens: usage.compactAtTokens,
      segments: {
        system: systemTokens,
        tools: toolTokens,
        messages: usedTokens - systemTokens - toolTokens,
      },
      compacted: usage.compacted,
      rawHistoryTokens: toTokens(history?.byteLength ?? 0) + system + tools,
      creditsSpent: Number(scope?.creditsSpent ?? 0),
      runCount: Number(scope?.runCount ?? 0),
      state: scope?.state ?? run.state,
    },
    HttpStatusCodes.OK
  )
}

const STOPPED_MESSAGE = "Stopped."

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

// Shared stop core (Stop button, queued-message steer, session archive).
// Null = the run was already terminal.
export async function requestRunStop(
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
      .returning({
        id: schema.agentRun.id,
        workspaceId: schema.agentRun.workspaceId,
      })
      .then((rows) => rows[0])
    if (settled) {
      notifyWorkspaceActivity(settled.workspaceId)
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
      // A queued run's plan was born "running" and no worker will ever settle
      // it — the run is stopping before any claim.
      await settleAbandonedRunPlan(
        { id: run.id, threadRootId: run.threadRootId },
        "stopped",
        (plan) => {
          void emitPlanUpdated(plan, { statusChanged: true }).catch((err) => {
            logger.warn(
              { err, runId: run.id, planId: plan.id },
              "Stopped-run plan emit failed"
            )
          })
        }
      ).catch((err) =>
        logger.warn({ err, runId: run.id }, "Stopped-run plan settle failed")
      )
      // The stop is already durable — a failed broadcast must not turn it
      // into a 500 (clients would keep a spinning placeholder AND an error).
      try {
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
      } catch (err) {
        logger.warn({ err, runId: run.id }, "Stop broadcast failed")
      }
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

  // Found by messageId, so the param is this run's message id.
  const outcome = await requestRunStop({ ...run, messageId }, currentUser.id)
  if (outcome) return c.json(outcome, HttpStatusCodes.OK)

  // A turn paused on approvals: Stop ends it with no reply. Its pending
  // approvals close as rejected (pi-harness-runbook.md §4.2).
  const closed = await stopPausedTurn(run.id, currentUser.id, "rejected")
  if (closed.length === 0) {
    return c.json(
      { success: false, message: "Run already finished" },
      HttpStatusCodes.CONFLICT
    )
  }
  notifyWorkspaceActivity(run.workspaceId)
  // Durable already: a failed broadcast or plan move must not fail the stop.
  try {
    const emitter = await getEmitter()
    for (const approval of closed) {
      emitter.to(channelRoom(run.channelId)).emit("approval:updated", {
        approvalId: approval.id,
        channelId: run.channelId,
        planId: approval.planId,
        status: approval.status,
        resolvedBy: approval.resolvedBy,
        resolvedAt: approval.resolvedAt?.toISOString() ?? null,
      })
    }
    const planId = closed.find((approval) => approval.planId)?.planId
    const plan = planId
      ? await db
          .update(schema.plan)
          .set({ status: "stopped" })
          .where(
            and(
              eq(schema.plan.id, planId),
              eq(schema.plan.status, "waiting_for_approval")
            )
          )
          .returning()
          .then((rows) => rows[0])
      : undefined
    if (plan) await emitPlanUpdated(plan, { statusChanged: true })
  } catch (err) {
    logger.warn({ err, runId: run.id }, "Paused turn stop broadcast failed")
  }
  return c.json({ state: run.state, stopped: true }, HttpStatusCodes.OK)
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

  // Conversational scopes always carry a placeholder message; a null here
  // can't happen for them (an Act run is message-less only before its
  // session exists).
  const outcome = active?.messageId
    ? await requestRunStop(
        { ...active, messageId: active.messageId },
        currentUser.id
      )
    : null
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
  try {
    const emitter = await getEmitter()
    emitter
      .to(threadRootId ? threadRoom(threadRootId) : channelRoom(row.channelId))
      .emit("run:queue:updated", {
        channelId: row.channelId,
        threadRootId,
        messageId,
        state: "cancelled",
      })
  } catch (err) {
    logger.warn({ err, messageId }, "Cancelled queue message emit failed")
  }
  return c.json({ removed: true }, HttpStatusCodes.OK)
}
