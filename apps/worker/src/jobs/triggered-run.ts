import { db, eq, schema } from "@repo/db"
import { flushActWindow } from "@repo/lor/act-runs"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type {
  ActFlushJobData,
  LorRespondJobData,
  TriggeredRunJobData,
} from "@repo/realtime-types/queues"
import { ACT_FLUSH_JOB } from "@repo/realtime-types/queues"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job, Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { startActSession } from "@/lib/trigger-session"
import { cancelPendingRun } from "@/lib/unattended-run"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

type RedisClient = ReturnType<typeof createClient>

// The Act effect: a prepared run (one delivery, or a flushed batch) becomes
// a new session whose first turn is the event, answered by Lor like any
// session turn. See lib/trigger-session.ts and
// reference/automation-primitives.md §2.
export function createTriggeredRunProcessor(
  emitter: Emitter<ServerToClientEvents>,
  redis: RedisClient,
  respondQueue: Queue<LorRespondJobData>,
  // Own queue: a batch waiting on an in-flight run re-arms its flush.
  triggeredQueue: Queue<TriggeredRunJobData | ActFlushJobData>
) {
  return async (job: Job<TriggeredRunJobData | ActFlushJobData>) => {
    // Two shapes on one queue: a prepared run, or a window flush that turns
    // everything a burst delivered into a single run.
    let runId: string
    let payload: string
    let label: string
    if (job.name === ACT_FLUSH_JOB) {
      const { triggerId } = job.data as ActFlushJobData
      const flushed = await flushActWindow(triggerId, notifyWorkspaceActivity)
      if (flushed.kind === "retry") {
        await triggeredQueue.add(
          ACT_FLUSH_JOB,
          { triggerId },
          {
            delay: flushed.delayMs,
            attempts: 2,
            backoff: { type: "fixed", delay: 5000 },
            removeOnComplete: true,
          }
        )
        return
      }
      if (flushed.kind === "skip") {
        logger.info({ triggerId, reason: flushed.reason }, "Act flush skipped")
        return
      }
      // Deliveries that landed while this batch was being claimed get their own
      // flush — enqueued before the run executes so it can't be lost with it.
      if (flushed.rearmDelayMs !== undefined) {
        await triggeredQueue
          .add(
            ACT_FLUSH_JOB,
            { triggerId },
            {
              delay: flushed.rearmDelayMs,
              attempts: 2,
              backoff: { type: "fixed", delay: 5000 },
              removeOnComplete: true,
            }
          )
          .catch((err) =>
            logger.error({ err, triggerId }, "Act straggler re-arm failed")
          )
      }
      ;({ runId, payload, label } = flushed.run)
    } else {
      ;({ runId, payload, label } = job.data as TriggeredRunJobData)
    }

    const run = await db
      .select({
        id: schema.agentRun.id,
        workspaceId: schema.agentRun.workspaceId,
        channelId: schema.agentRun.channelId,
        triggerId: schema.agentRun.triggerId,
        messageId: schema.agentRun.messageId,
        state: schema.agentRun.state,
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, runId))
      .then((rows) => rows[0])
    if (!run?.triggerId) {
      logger.error({ runId }, "Triggered job without a run/trigger; skipping")
      return
    }
    // Already in its session, or settled: a retried job must not start a
    // second session.
    if (run.messageId || run.state !== "queued") return

    // Kill switch, re-read at process time: disabling the trigger (or
    // clearing its instructions) between ack and execution cancels the run.
    const trigger = await db
      .select({
        enabled: schema.connectorTrigger.enabled,
        actInstructions: schema.connectorTrigger.actInstructions,
        connectedById: schema.integrationConnection.createdBy,
      })
      .from(schema.connectorTrigger)
      .leftJoin(
        schema.integrationConnection,
        eq(
          schema.connectorTrigger.connectionId,
          schema.integrationConnection.id
        )
      )
      .where(eq(schema.connectorTrigger.id, run.triggerId))
      .then((rows) => rows[0])
    if (!trigger?.enabled || trigger.actInstructions === null) {
      await cancelPendingRun(runId)
      logger.info({ runId }, "Triggered run cancelled; trigger disabled")
      return
    }

    // Never thrown to BullMQ: a retry after the session exists would make a
    // second one. A run left queued is swept as dead, and its deliveries
    // requeue (prune-run-events).
    await startActSession(
      { emitter, redis, respondQueue },
      {
        runId,
        workspaceId: run.workspaceId,
        channelId: run.channelId,
        triggerId: run.triggerId,
        connectedById: trigger.connectedById ?? null,
        label,
        payload,
      }
    ).catch((err) => logger.error({ err, runId }, "Act session start failed"))
  }
}
