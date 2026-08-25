import {
  and,
  db,
  eq,
  isNotNull,
  isUniqueViolation,
  lte,
  schema,
} from "@repo/db"
import { env } from "@repo/env/server"
import { nextLoopRunAt } from "@repo/merlin/loop-schedule"
import { toRealtimeLoop } from "@repo/merlin/loops"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { LOOP_RUN_JOB, type LoopRunJobData } from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import { logger } from "@/lib/logger"

export const LOOP_SWEEP_EVERY_MS = 60_000
// Per-tick ceiling; anything beyond it is still due next minute. Keeps one
// pathological tick (huge backlog after downtime) from monopolizing the
// maintenance worker.
const SWEEP_BATCH = 100

// The loop scheduler: Postgres is the only source of truth (loop.nextRunAt,
// partial-indexed on active), and this 60s sweep is the only clock. Claim is
// a CAS that advances nextRunAt — computed from NOW, so a missed schedule
// fires once and never backlogs — then the winner creates the run
// (scopeKey = loop.id) and enqueues it. A previous run still in flight makes
// the run insert lose the active-scope unique index: that tick is skipped by
// design. See reference/loops.md.
export async function sweepDueLoops(
  emitter: Emitter<ServerToClientEvents>,
  loopRunQueue: Queue<LoopRunJobData>
): Promise<void> {
  const due = await db
    .select({
      id: schema.loop.id,
      workspaceId: schema.loop.workspaceId,
      channelId: schema.loop.channelId,
      schedule: schema.loop.schedule,
      timezone: schema.loop.timezone,
      nextRunAt: schema.loop.nextRunAt,
      endAt: schema.loop.endAt,
    })
    .from(schema.loop)
    .where(
      and(
        eq(schema.loop.status, "active"),
        isNotNull(schema.loop.nextRunAt),
        lte(schema.loop.nextRunAt, new Date())
      )
    )
    .limit(SWEEP_BATCH)

  for (const loop of due) {
    // Date end (endAt) is enforced mechanically here: a due fire scheduled
    // past the end date completes the loop instead of running — no model
    // judgment involved. Fires scheduled before the end still run.
    if (loop.endAt && loop.nextRunAt && loop.nextRunAt > loop.endAt) {
      const ended = await db
        .update(schema.loop)
        .set({
          status: "completed",
          completedNote: "Reached its end date",
          pausedReason: null,
          nextRunAt: null,
        })
        .where(
          and(eq(schema.loop.id, loop.id), eq(schema.loop.status, "active"))
        )
        .returning()
        .then((rows) => rows[0] ?? null)
      if (ended) {
        logger.info({ loopId: loop.id }, "Loop completed; end date reached")
        emitter
          .to(channelRoom(ended.channelId))
          .emit("loop:updated", { loop: toRealtimeLoop(ended) })
      }
      continue
    }

    // A schedule that can't produce a next fire (invalid after an edit, a
    // cron with no future occurrences, or a null timezone — an invariant
    // violation: activation always pins one) pauses the loop instead of
    // wedging the sweep on it every tick.
    let next: Date | null = null
    try {
      if (loop.timezone) next = nextLoopRunAt(loop.schedule, loop.timezone)
      else logger.error({ loopId: loop.id }, "Active loop has no timezone")
    } catch (err) {
      logger.error({ err, loopId: loop.id }, "Loop schedule unparsable")
    }
    if (!next) {
      const paused = await db
        .update(schema.loop)
        .set({ status: "paused", pausedReason: "failures", nextRunAt: null })
        .where(
          and(eq(schema.loop.id, loop.id), eq(schema.loop.status, "active"))
        )
        .returning()
        .then((rows) => rows[0] ?? null)
      if (paused) {
        logger.warn(
          { loopId: loop.id },
          "Loop paused; schedule has no next fire"
        )
        emitter
          .to(channelRoom(paused.channelId))
          .emit("loop:updated", { loop: toRealtimeLoop(paused) })
      }
      continue
    }

    // CAS claim: concurrent sweeps (or an edit that already moved nextRunAt)
    // lose the predicate and skip. lastRunAt is set at claim — it means "last
    // fired", not "last finished".
    const claimed = await db
      .update(schema.loop)
      .set({ nextRunAt: next, lastRunAt: new Date() })
      .where(
        and(
          eq(schema.loop.id, loop.id),
          eq(schema.loop.status, "active"),
          isNotNull(schema.loop.nextRunAt),
          lte(schema.loop.nextRunAt, new Date())
        )
      )
      .returning({ id: schema.loop.id })
      .then((rows) => rows[0] ?? null)
    if (!claimed) continue

    // scopeKey = loop.id: the partial unique index on active runs makes "one
    // run per loop at a time" a database invariant — an insert losing it
    // means the previous run is still going, and this tick is skipped
    // (nextRunAt already advanced).
    const run = await db
      .insert(schema.agentRun)
      .values({
        workspaceId: loop.workspaceId,
        channelId: loop.channelId,
        scopeKey: loop.id,
        loopId: loop.id,
        scheduledFor: loop.nextRunAt,
        budgetSteps: env.AGENT_RUN_MAX_STEPS,
        budgetInputTokens: env.AGENT_RUN_MAX_INPUT_TOKENS,
        budgetOutputTokens: env.AGENT_RUN_MAX_OUTPUT_TOKENS,
        budgetToolCalls: env.AGENT_RUN_MAX_TOOL_CALLS,
        budgetToolOutputBytes: env.AGENT_RUN_MAX_TOOL_OUTPUT_BYTES,
        budgetWallMs: env.AGENT_RUN_MAX_WALL_MS,
        budgetCredits: env.AGENT_RUN_MAX_CREDITS,
      })
      .returning({ id: schema.agentRun.id })
      .then((rows) => rows[0] ?? null)
      .catch((err) => {
        if (isUniqueViolation(err)) {
          logger.info(
            { loopId: loop.id },
            "Loop tick skipped; previous run still active"
          )
          return null
        }
        logger.error({ err, loopId: loop.id }, "Loop run insert failed")
        return null
      })
    if (!run) continue

    try {
      await loopRunQueue.add(
        LOOP_RUN_JOB,
        { runId: run.id, loopId: loop.id },
        {
          jobId: run.id,
          attempts: 2,
          backoff: { type: "fixed", delay: 5000 },
          removeOnComplete: true,
        }
      )
    } catch (err) {
      // A run row with no job behind it would sit until the dead-run sweep
      // force-fails it — unwind instead, the next tick recreates it.
      logger.error({ err, loopId: loop.id }, "Loop run enqueue failed")
      await db
        .delete(schema.agentRun)
        .where(eq(schema.agentRun.id, run.id))
        .catch(() => {})
    }
  }
}
