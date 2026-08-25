import { and, db, eq, schema, sql } from "@repo/db"
import { loopRunBriefing } from "@repo/merlin/loop-runs"
import { describeLoopSchedule } from "@repo/merlin/loop-schedule"
import { toRealtimeLoop } from "@repo/merlin/loops"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type {
  LoopRunJobData,
  MerlinRespondJobData,
} from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job, Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { postMerlinMessage } from "@/lib/merlin-messages"
import { createMerlinTask } from "@/lib/merlin-task"
import {
  cancelPendingRun,
  runUnattended,
  type UnattendedSettlement,
} from "@/lib/unattended-run"

type RedisClient = ReturnType<typeof createClient>

// Consecutive terminal failures (incl. out_of_credits) before a loop pauses
// itself and tells the channel. See reference/loops.md.
export const LOOP_AUTO_PAUSE_FAILURES = 5

function emitLoopUpdated(
  emitter: Emitter<ServerToClientEvents>,
  row: typeof schema.loop.$inferSelect
) {
  emitter
    .to(channelRoom(row.channelId))
    .emit("loop:updated", { loop: toRealtimeLoop(row) })
}

// Failure accounting lives at run settlement, not BullMQ events — the
// executor maps errors to a terminal run state without failing the job, so
// job-level counting would miss almost everything. `stopped` (pause/user
// stop) is neutral: it says nothing about the loop's health.
export async function settleLoopRun(
  deps: { emitter: Emitter<ServerToClientEvents>; redis: RedisClient },
  loopId: string,
  settlement: UnattendedSettlement
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
    .set({
      consecutiveFailures: sql`${schema.loop.consecutiveFailures} + 1`,
    })
    .where(and(eq(schema.loop.id, loopId), eq(schema.loop.status, "active")))
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!failed) return

  if (failed.consecutiveFailures < LOOP_AUTO_PAUSE_FAILURES) {
    emitLoopUpdated(deps.emitter, failed)
    return
  }

  const paused = await db
    .update(schema.loop)
    .set({
      status: "paused",
      pausedReason:
        settlement.stopReason === "out_of_credits"
          ? "out_of_credits"
          : "failures",
      nextRunAt: null,
    })
    .where(and(eq(schema.loop.id, loopId), eq(schema.loop.status, "active")))
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!paused) return

  logger.warn(
    { loopId, failures: paused.consecutiveFailures },
    "Loop auto-paused after consecutive failures"
  )
  emitLoopUpdated(deps.emitter, paused)
  await postMerlinMessage(deps, {
    channelId: paused.channelId,
    content:
      paused.pausedReason === "out_of_credits"
        ? `Paused the loop **${paused.name}** — the workspace is out of credits. Resume it once credits are topped up.`
        : `Paused the loop **${paused.name}** after ${LOOP_AUTO_PAUSE_FAILURES} consecutive failed runs — resume it when ready.`,
  }).catch((err) =>
    logger.error({ err, loopId }, "Loop auto-pause channel note failed")
  )
}

// Scheduled loop runs: the sweep claimed the due loop, created the run row
// (scopeKey = loop.id) and enqueued this job. Same unattended rails as Act
// triggers, plus the loop framing (end condition, complete_loop) and
// settlement-based failure accounting. See reference/loops.md.
export function createLoopRunProcessor(
  emitter: Emitter<ServerToClientEvents>,
  redis: RedisClient,
  respondQueue: Queue<MerlinRespondJobData>
) {
  return async (job: Job<LoopRunJobData>) => {
    const { runId, loopId } = job.data

    const run = await db
      .select({
        id: schema.agentRun.id,
        workspaceId: schema.agentRun.workspaceId,
        channelId: schema.agentRun.channelId,
        loopId: schema.agentRun.loopId,
        scheduledFor: schema.agentRun.scheduledFor,
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, runId))
      .then((rows) => rows[0])
    if (!run?.loopId || run.loopId !== loopId) {
      logger.error({ runId, loopId }, "Loop job without a run/loop; skipping")
      return
    }

    // Kill switch, re-read at process time: pausing/completing the loop
    // between claim and execution cancels the run.
    const loop = await db
      .select()
      .from(schema.loop)
      .where(eq(schema.loop.id, loopId))
      .then((rows) => rows[0])
    if (!loop || loop.status !== "active") {
      await cancelPendingRun(runId)
      logger.info({ runId, loopId }, "Loop run cancelled; loop not active")
      return
    }

    const scheduleDescription = describeLoopSchedule(
      loop.schedule,
      loop.timezone
    )
    const label = `Loop · ${loop.name}`
    const firedAt = run.scheduledFor ?? new Date()

    await runUnattended(
      { emitter, redis },
      {
        runId,
        channelId: run.channelId,
        label,
        payload: `Scheduled run of the loop "${loop.name}" (${scheduleDescription}), due ${firedAt.toISOString()}.`,
        kind: "Loop",
        sandboxKey: loopId,
        triggered: {
          label,
          instructions: loop.instructions,
          loop: {
            name: loop.name,
            scheduleDescription,
            endCondition: loop.endCondition,
          },
          postMessage: (content) =>
            postMerlinMessage(
              { emitter, redis },
              { channelId: run.channelId, content }
            ),
          createTask: ({ title, goal }) =>
            createMerlinTask(
              { emitter, redis, respondQueue },
              {
                workspaceId: run.workspaceId,
                channelId: run.channelId,
                title,
                goal,
                originRunId: runId,
              }
            ),
          completeLoop: loop.endCondition
            ? async ({ closingNote }) => {
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
                      eq(schema.loop.id, loopId),
                      eq(schema.loop.status, "active")
                    )
                  )
                  .returning()
                  .then((rows) => rows[0] ?? null)
                // Paused/completed since this run started — the tool must not
                // report success for a transition that didn't happen.
                if (!completed) throw new Error("Loop is no longer active")
                logger.info(
                  { loopId, runId },
                  "Loop completed by complete_loop"
                )
                emitLoopUpdated(emitter, completed)
              }
            : // No end condition = nothing for the model to judge — don't hand
              // it a stop-everything button (one live loop got wrongly
              // completed that way). Date/manual ends are mechanical.
              undefined,
        },
        composeBriefing: () =>
          loopRunBriefing({ loopId, channelId: run.channelId, runId }),
        onSettled: (settlement) =>
          settleLoopRun({ emitter, redis }, loopId, settlement),
      }
    )
  }
}
