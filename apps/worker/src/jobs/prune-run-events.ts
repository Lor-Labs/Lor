import {
  and,
  db,
  eq,
  inArray,
  isNotNull,
  isNull,
  LOR_USER_ID,
  lt,
  notExists,
  or,
  schema,
} from "@repo/db"
import { env } from "@repo/env/server"
import { openActWindow, releaseActRunDeliveries } from "@repo/lor/act-runs"
import { settleAbandonedRunPlan, toRealtimePlan } from "@repo/lor/plans"
import { loadThreadSummary } from "@repo/messaging"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  ACT_FLUSH_JOB,
  type ActFlushJobData,
  type LorRespondJobData,
  type TriggeredRunJobData,
} from "@repo/realtime-types/queues"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { settleLoopRun } from "@/lib/loop-session"
import { drainScopeQueue } from "@/lib/run-queue"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

export const RUN_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const RUN_EVENT_PRUNE_EVERY_MS = 6 * 60 * 60 * 1000 // q 6 hrs
export const DEAD_RUN_SWEEP_EVERY_MS = 10 * 60 * 1000 // q 10 min
// Grace past the wall-clock deadline; an alive attempt errors out at the
// deadline itself, so anything still non-terminal this far past it is dead.
const DEAD_RUN_GRACE_MS = 10 * 60 * 1000
// Unclaimed queued runs have no deadline yet — give them a much longer grace
// so a worker-outage backlog isn't force-failed just before its jobs run.
const UNCLAIMED_RUN_GRACE_MS = 30 * 60 * 1000

const DEAD_RUN_MESSAGE = "I ran into an error answering that. Please try again."

// Run events are replay data for in-flight runs; once a run is terminal the
// message row holds the durable trail, so prune old terminal runs' events.
// Idempotent — safe to run from any number of worker replicas.
//
// Events ONLY. `agent_run_step` is the permanent record of what a run did and
// is never pruned: run history and context continuation (a follow-up run
// replaying its predecessors' transcripts) both read it. Adding a retention
// sweep there would silently break both — see reference/agent-harness.md.
export async function pruneRunEvents(): Promise<void> {
  const cutoff = new Date(Date.now() - RUN_EVENT_RETENTION_MS)
  const stale = db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(
      and(
        isNotNull(schema.agentRun.finishedAt),
        lt(schema.agentRun.finishedAt, cutoff)
      )
    )
  await db
    .delete(schema.agentRunEvent)
    .where(inArray(schema.agentRunEvent.runId, stale))
  logger.info("Pruned expired agent run events")
}

// Safety net for runs nothing will ever finalize: past-deadline runs whose
// attempts all died (double-crash), and queued runs never claimed at all
// (deadlineAt is only set at claim — e.g. the job was consumed by a worker
// without run-claiming code, or dropped entirely). Fail the run and settle
// its stuck pending placeholder.
export async function sweepDeadRuns(
  emitter: Emitter<ServerToClientEvents>,
  // For the loop-settlement channel note (auto-pause posts as Lor).
  redis: ReturnType<typeof createClient>,
  respondQueue: Queue<LorRespondJobData>,
  // Triggered runs hand their claimed deliveries back through this queue.
  triggeredQueue: Queue<TriggeredRunJobData | ActFlushJobData>
): Promise<void> {
  const deadPredicate = () =>
    or(
      and(
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"]),
        isNotNull(schema.agentRun.deadlineAt),
        lt(schema.agentRun.deadlineAt, new Date(Date.now() - DEAD_RUN_GRACE_MS))
      ),
      and(
        eq(schema.agentRun.state, "queued"),
        isNull(schema.agentRun.deadlineAt),
        lt(
          schema.agentRun.createdAt,
          new Date(Date.now() - UNCLAIMED_RUN_GRACE_MS)
        )
      )
    )
  const candidates = await db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(deadPredicate())

  // One transaction per run: the failure and its placeholder settle together,
  // so a run can never go terminal while its message stays pending forever.
  // The update re-checks the dead predicate, keeping concurrent sweeps (and a
  // claim that landed since the select) from double-failing a run. Headless
  // triggered runs have no placeholder message — only the run row settles.
  const dead: {
    id: string
    messageId: string | null
    workspaceId: string
    channelId: string
    threadRootId: string | null
    triggerId: string | null
    loopId: string | null
    settled: boolean
  }[] = []
  for (const candidate of candidates) {
    const result = await db
      .transaction(async (tx) => {
        const run = await tx
          .update(schema.agentRun)
          .set({ state: "failed", stopReason: "error", finishedAt: new Date() })
          .where(and(eq(schema.agentRun.id, candidate.id), deadPredicate()))
          .returning({
            id: schema.agentRun.id,
            messageId: schema.agentRun.messageId,
            workspaceId: schema.agentRun.workspaceId,
            channelId: schema.agentRun.channelId,
            threadRootId: schema.agentRun.threadRootId,
            triggerId: schema.agentRun.triggerId,
            loopId: schema.agentRun.loopId,
          })
          .then((r) => r[0])
        if (!run) return null
        if (!run.messageId) return { ...run, settled: false }
        const settled = await tx
          .update(schema.message)
          .set({ content: DEAD_RUN_MESSAGE, status: "failed" })
          .where(
            and(
              eq(schema.message.id, run.messageId),
              eq(schema.message.status, "pending")
            )
          )
          .returning({ id: schema.message.id })
        return { ...run, settled: settled.length > 0 }
      })
      .catch((err) => {
        logger.error(
          { err, runId: candidate.id },
          "Dead-run sweep failed; will retry next cycle"
        )
        return null
      })
    if (result) {
      dead.push(result)
      notifyWorkspaceActivity(result.workspaceId)
    }
  }
  for (const run of dead) {
    if (!run.settled || !run.messageId) continue
    const room = run.threadRootId
      ? threadRoom(run.threadRootId)
      : channelRoom(run.channelId)
    emitter.to(room).emit("message:stream", {
      channelId: run.channelId,
      threadRootId: run.threadRootId,
      messageId: run.messageId,
      delta: DEAD_RUN_MESSAGE,
      done: true,
      status: "failed",
      replace: true,
    })
    // Channel viewers only see threaded settles via message:thread:updated.
    if (run.threadRootId) {
      await loadThreadSummary(run.channelId, run.threadRootId)
        .then((summary) =>
          emitter
            .to(channelRoom(run.channelId))
            .emit("message:thread:updated", summary)
        )
        .catch((err) =>
          logger.warn(
            { err, runId: run.id },
            "Dead-run thread summary emit failed"
          )
        )
    }
  }
  // A dead run's plan would otherwise stay "running" forever — every settle
  // path lives in the crashed processor, and this sweep is the only actor
  // left. Settles the run's own plan (claimed or never-claimed first run).
  for (const run of dead) {
    await settleAbandonedRunPlan(
      { id: run.id, threadRootId: run.threadRootId },
      "failed",
      (plan) => {
        emitter
          .to(channelRoom(run.channelId))
          .emit("plan:updated", { plan: toRealtimePlan(plan) })
        notifyWorkspaceActivity(plan.workspaceId)
      }
    ).catch((err) =>
      logger.error({ err, runId: run.id }, "Dead-run plan settle failed")
    )
  }
  // A dead run may have steered/queued messages behind it — drain each scope
  // so they start a follow-up run instead of stranding.
  for (const run of dead) {
    await drainScopeQueue({ runId: run.id, emitter, respondQueue }).catch(
      (err) => logger.error({ err, runId: run.id }, "Scope queue drain failed")
    )
  }
  // Same rule for Act: the deliveries this run claimed were never handled, and
  // a delivery is never dropped for a failure that wasn't its fault. Release
  // them and re-arm the trigger so the next flush covers them.
  for (const run of dead) {
    if (!run.triggerId) continue
    const triggerId = run.triggerId
    await releaseActRunDeliveries(run.id)
      .then(async (released) => {
        if (released === 0) return
        logger.warn(
          { runId: run.id, triggerId, released },
          "Requeued deliveries from an abandoned Act run"
        )
        const openedAt = await openActWindow(triggerId, 0)
        if (!openedAt) return
        await triggeredQueue.add(
          ACT_FLUSH_JOB,
          { triggerId },
          { attempts: 2, removeOnComplete: true }
        )
      })
      .catch((err) =>
        logger.error(
          { err, runId: run.id, triggerId },
          "Act delivery requeue failed"
        )
      )
  }
  // Loop runs settle their failure accounting at the run's terminal
  // transition — a force-failed dead run reached it here, not in the
  // processor, so the counter/auto-pause pass runs here too.
  for (const run of dead) {
    if (!run.loopId || !run.threadRootId) continue
    await settleLoopRun({ emitter, redis }, run.loopId, run.threadRootId, {
      outcome: "failed",
      stopReason: "error",
    }).catch((err) =>
      logger.error(
        { err, runId: run.id, loopId: run.loopId },
        "Dead loop-run settlement failed"
      )
    )
  }
  if (dead.length > 0) {
    logger.warn(
      { count: dead.length, runIds: dead.map((r) => r.id) },
      "Swept dead agent runs past their deadline"
    )
  }
}

// Legacy jobs have no run row; allow their full wall budget before cleanup.
export async function sweepOrphanedPlaceholders(
  emitter: Emitter<ServerToClientEvents>
) {
  const cutoff = new Date(
    Date.now() - env.AGENT_RUN_MAX_WALL_MS - UNCLAIMED_RUN_GRACE_MS
  )
  const orphans = await db
    .update(schema.message)
    .set({ status: "failed", content: DEAD_RUN_MESSAGE })
    .where(
      and(
        eq(schema.message.authorId, LOR_USER_ID),
        eq(schema.message.status, "pending"),
        lt(schema.message.createdAt, cutoff),
        notExists(
          db
            .select({ id: schema.agentRun.id })
            .from(schema.agentRun)
            .where(eq(schema.agentRun.messageId, schema.message.id))
        )
      )
    )
    .returning()
  for (const message of orphans) {
    try {
      emitter
        .to(
          message.threadRootId
            ? threadRoom(message.threadRootId)
            : channelRoom(message.channelId)
        )
        .emit("message:stream", {
          channelId: message.channelId,
          threadRootId: message.threadRootId,
          messageId: message.id,
          delta: DEAD_RUN_MESSAGE,
          done: true,
          status: "failed",
          replace: true,
        })
      await settleAbandonedRunPlan(
        { threadRootId: message.threadRootId },
        "failed",
        (plan) => {
          emitter
            .to(channelRoom(message.channelId))
            .emit("plan:updated", { plan: toRealtimePlan(plan) })
          notifyWorkspaceActivity(plan.workspaceId)
        }
      )
      if (message.threadRootId) {
        const summary = await loadThreadSummary(
          message.channelId,
          message.threadRootId
        )
        emitter
          .to(channelRoom(message.channelId))
          .emit("message:thread:updated", summary)
      }
    } catch (err) {
      logger.error(
        { err, messageId: message.id },
        "Orphaned placeholder settlement failed"
      )
    }
  }
  if (orphans.length)
    logger.warn({ count: orphans.length }, "Swept orphaned Lor placeholders")
}
