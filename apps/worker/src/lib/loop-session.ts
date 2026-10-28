import {
  and,
  db,
  eq,
  inArray,
  isNull,
  LOR_USER_ID,
  schema,
  sql,
} from "@repo/db"
import { findAgentSessionByThreadRoot } from "@repo/db/queries/agent-sessions"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import type { Loop } from "@repo/db/schema"
import type { RunLoopContext } from "@repo/lor"
import {
  ensureLoopSession,
  toRealtimeAgentSession,
} from "@repo/lor/agent-sessions"
import { describeLoopSchedule } from "@repo/lor/loop-schedule"
import { toRealtimeLoop } from "@repo/lor/loops"
import { channelEventContent } from "@repo/messaging"
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

type LoopDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: ReturnType<typeof createClient>
}

// Consecutive terminal failures (incl. out_of_credits) before a loop pauses
// itself and says so in its session. See reference/loops.md.
export const LOOP_AUTO_PAUSE_FAILURES = 5

const ACTIVE_RUN_STATES = ["queued", "working", "finalizing"] as const

export function emitLoopUpdated(
  emitter: Emitter<ServerToClientEvents>,
  row: Loop
) {
  emitter
    .to(channelRoom(row.channelId))
    .emit("loop:updated", { loop: toRealtimeLoop(row) })
}

// One fire of a loop is one turn in its session (reference/workspace-model.md,
// decision 1): a "ran on schedule" line, then Lor's reply under it, through
// the same run path as a person's message. A person's turn holding the
// session makes the fire wait in its queue; the loop's own previous run still
// going skips the fire, as before sessions. A fire unarchives the session.
export async function fireLoop(
  deps: LoopDeps & { respondQueue: Queue<LorRespondJobData> },
  loop: Loop,
  scheduledFor: Date
): Promise<"started" | "queued" | "skipped" | "failed"> {
  if ((await workspaceBetaAccess(loop.workspaceId)).state !== "active")
    return "skipped"
  const session = await ensureLoopSession(loop)
  deps.emitter
    .to(channelRoom(loop.channelId))
    .emit("session:updated", { session: toRealtimeAgentSession(session) })
  notifyWorkspaceActivity(loop.workspaceId)
  const scopeKey = session.threadRootId

  const activeRun = () =>
    db
      .select({ id: schema.agentRun.id, loopId: schema.agentRun.loopId })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.scopeKey, scopeKey),
          inArray(schema.agentRun.state, [...ACTIVE_RUN_STATES])
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

  let active = await activeRun()
  if (active?.loopId === loop.id) return "skipped"

  const { messageId: fireId } = await postLorMessage(deps, {
    channelId: loop.channelId,
    threadRootId: scopeKey,
    content: channelEventContent({
      eventType: "loop_run",
      loopName: loop.name,
    }),
    type: "event",
    eventType: "loop_run",
    eventPayload: { loopId: loop.id, loopName: loop.name },
    silent: true,
  })
  const start = () =>
    startScopeRun(deps, {
      workspaceId: loop.workspaceId,
      channelId: loop.channelId,
      threadRootId: scopeKey,
      scopeKey,
      triggerMessageId: fireId,
      loopId: loop.id,
      scheduledFor,
    })

  // Two tries cover a run starting or ending between the read and the write.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!active) {
      const started = await start()
      if (started !== "busy") return started
      active = await activeRun()
      continue
    }
    const queuedId = await db
      .insert(schema.agentRunQueue)
      .values({
        scopeKey,
        runId: active.id,
        messageId: fireId,
        senderId: LOR_USER_ID,
        state: "queued",
      })
      .onConflictDoNothing({ target: schema.agentRunQueue.messageId })
      .returning({ id: schema.agentRunQueue.id })
      .then((rows) => rows[0]?.id ?? null)
    if (!queuedId) return "queued"
    // The holder may have settled (and drained) before the row landed.
    const stillActive = await activeRun()
    if (stillActive?.id === active.id) return "queued"
    await db
      .delete(schema.agentRunQueue)
      .where(
        and(
          eq(schema.agentRunQueue.id, queuedId),
          eq(schema.agentRunQueue.state, "queued")
        )
      )
    active = stillActive
  }
  logger.warn({ loopId: loop.id }, "Loop fire could not start or queue")
  return "failed"
}

// The loop behind a run in a loop's session, and whether this run answers
// one of its fires (its trigger is the "ran on schedule" line).
export async function loadLoopRun(
  threadRootId: string | null,
  triggerMessageId: string
): Promise<{ loop: Loop; isFire: boolean } | null> {
  if (!threadRootId) return null
  const session = await findAgentSessionByThreadRoot(threadRootId)
  if (!session?.loopId) return null
  const [loop, trigger] = await Promise.all([
    db
      .select()
      .from(schema.loop)
      .where(eq(schema.loop.id, session.loopId))
      .then((rows) => rows[0] ?? null),
    db
      .select({ eventType: schema.message.eventType })
      .from(schema.message)
      .where(eq(schema.message.id, triggerMessageId))
      .then((rows) => rows[0] ?? null),
  ])
  if (!loop) return null
  return { loop, isFire: trigger?.eventType === "loop_run" }
}

// A fire that waited in the session queue was started by the drain, which
// knows nothing of loops: tag the run so pause stops it and history lists it.
export async function markLoopFireRun(runId: string, loopId: string) {
  await db
    .update(schema.agentRun)
    .set({
      loopId,
      scheduledFor: sql`coalesce(${schema.agentRun.scheduledFor}, now())`,
    })
    .where(and(eq(schema.agentRun.id, runId), isNull(schema.agentRun.loopId)))
}

// The loop's brief for every run in its session. complete_loop only exists
// when there is an end condition to judge: date and manual ends are
// mechanical, and one live loop got wrongly completed without one.
export function loopRunContext(
  deps: LoopDeps,
  loop: Loop,
  threadRootId: string
): RunLoopContext {
  return {
    name: loop.name,
    scheduleDescription: describeLoopSchedule(loop.schedule, loop.timezone),
    instructions: loop.instructions,
    endCondition: loop.endCondition,
    ...(loop.endCondition
      ? {
          completeLoop: async ({ closingNote }) => {
            const completed = await db
              .update(schema.loop)
              .set({
                status: "completed",
                completedNote: closingNote,
                pausedReason: null,
                nextRunAt: null,
              })
              .where(
                and(
                  eq(schema.loop.id, loop.id),
                  eq(schema.loop.status, "active")
                )
              )
              .returning()
              .then((rows) => rows[0] ?? null)
            // Paused/completed since this run started — the tool must not
            // report success for a transition that didn't happen.
            if (!completed) throw new Error("Loop is no longer active")
            logger.info({ loopId: loop.id }, "Loop completed by complete_loop")
            emitLoopUpdated(deps.emitter, completed)
            await postLorMessage(deps, {
              channelId: completed.channelId,
              threadRootId,
              content: channelEventContent({
                eventType: "loop_completed",
                actorName: "Lor",
                loopName: completed.name,
              }),
              type: "event",
              eventType: "loop_completed",
              eventPayload: { loopId: completed.id, loopName: completed.name },
              silent: true,
            }).catch((err) =>
              logger.error(
                { err, loopId: loop.id },
                "Loop completed note failed"
              )
            )
          },
        }
      : {}),
  }
}

// Failure accounting at fire settlement. `stopped` (pause, user stop) says
// nothing about the loop's health. Enough failures in a row pause the loop
// and say so in its session.
export async function settleLoopRun(
  deps: LoopDeps,
  loopId: string,
  threadRootId: string,
  settlement: {
    outcome: "complete" | "failed" | "stopped"
    stopReason?: string
  }
): Promise<void> {
  if (settlement.outcome === "stopped") return

  if (settlement.outcome === "complete") {
    const row = await db
      .update(schema.loop)
      .set({ consecutiveFailures: 0 })
      .where(
        and(
          eq(schema.loop.id, loopId),
          sql`${schema.loop.consecutiveFailures} <> 0`
        )
      )
      .returning()
      .then((rows) => rows[0] ?? null)
    if (row) emitLoopUpdated(deps.emitter, row)
    return
  }

  // Only active loops accrue failures — a loop paused/completed mid-run
  // (kill switch raced) must not be re-touched.
  const failed = await db
    .update(schema.loop)
    .set({ consecutiveFailures: sql`${schema.loop.consecutiveFailures} + 1` })
    .where(and(eq(schema.loop.id, loopId), eq(schema.loop.status, "active")))
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!failed) return
  if (failed.consecutiveFailures < LOOP_AUTO_PAUSE_FAILURES) {
    emitLoopUpdated(deps.emitter, failed)
    return
  }

  const reason =
    settlement.stopReason === "out_of_credits" ? "out_of_credits" : "failures"
  const paused = await db
    .update(schema.loop)
    .set({ status: "paused", pausedReason: reason, nextRunAt: null })
    .where(and(eq(schema.loop.id, loopId), eq(schema.loop.status, "active")))
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!paused) return

  logger.warn(
    { loopId, failures: paused.consecutiveFailures },
    "Loop auto-paused after consecutive failures"
  )
  emitLoopUpdated(deps.emitter, paused)
  await postLorMessage(deps, {
    channelId: paused.channelId,
    threadRootId,
    content: channelEventContent({
      eventType: "loop_paused",
      loopName: paused.name,
      reason,
    }),
    type: "event",
    eventType: "loop_paused",
    eventPayload: { loopId: paused.id, loopName: paused.name, reason },
    silent: true,
  }).catch((err) =>
    logger.error({ err, loopId }, "Loop auto-pause session note failed")
  )
}
