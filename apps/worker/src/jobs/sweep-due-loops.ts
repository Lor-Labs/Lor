import { and, db, eq, isNotNull, lte, schema } from "@repo/db"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import { nextLoopRunAt } from "@repo/lor/loop-schedule"
import { toRealtimeLoop } from "@repo/lor/loops"
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
// fires once and never backlogs — then the winner enqueues the fire. See
// reference/loops.md and lib/loop-session.ts.
export async function sweepDueLoops(
  emitter: Emitter<ServerToClientEvents>,
  loopRunQueue: Queue<LoopRunJobData>
): Promise<void> {
  const emitBetaPaused = (loop: typeof schema.loop.$inferSelect) =>
    emitter
      .to(channelRoom(loop.channelId))
      .emit("loop:updated", { loop: toRealtimeLoop(loop) })
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
    if ((await workspaceBetaAccess(loop.workspaceId)).state !== "active") {
      const [paused] = await db
        .update(schema.loop)
        .set({ status: "paused", pausedReason: "manual", nextRunAt: null })
        .where(
          and(eq(schema.loop.id, loop.id), eq(schema.loop.status, "active"))
        )
        .returning()
      if (paused) emitBetaPaused(paused)
      continue
    }
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

    // The fire job posts into the loop's session and starts or queues the
    // run; a previous fire still running skips this one there.
    const dueAt = loop.nextRunAt ?? new Date()
    try {
      await loopRunQueue.add(
        LOOP_RUN_JOB,
        { loopId: loop.id, scheduledFor: dueAt.toISOString() },
        {
          jobId: `${loop.id}-${dueAt.getTime()}`,
          attempts: 2,
          backoff: { type: "fixed", delay: 5000 },
          removeOnComplete: true,
        }
      )
    } catch (err) {
      // Restoring the claimed due time (CAS on the value this claim wrote, so
      // a concurrent schedule edit wins) lets the next tick re-claim this
      // fire rather than losing it until the following scheduled one.
      logger.error({ err, loopId: loop.id }, "Loop fire enqueue failed")
      await db
        .update(schema.loop)
        .set({ nextRunAt: loop.nextRunAt })
        .where(
          and(
            eq(schema.loop.id, loop.id),
            eq(schema.loop.status, "active"),
            eq(schema.loop.nextRunAt, next)
          )
        )
        .catch(() => {})
    }
  }
}
