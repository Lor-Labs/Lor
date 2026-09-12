import { db, eq, schema } from "@repo/db"
import { actRunBriefing, flushActWindow } from "@repo/merlin/act-runs"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type {
  ActFlushJobData,
  MerlinRespondJobData,
  TriggeredRunJobData,
} from "@repo/realtime-types/queues"
import { ACT_FLUSH_JOB } from "@repo/realtime-types/queues"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job, Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { postMerlinMessage as postMerlinChannelMessage } from "@/lib/merlin-messages"
import { createMerlinPlan } from "@/lib/merlin-plan"
import { cancelPendingRun, runUnattended } from "@/lib/unattended-run"

type RedisClient = ReturnType<typeof createClient>

// Headless triggered runs — the Act effect. No placeholder message, no
// streaming: Merlin gets the trigger's instructions + the event payload and
// decides the disposition via tools (post_channel_message / create_plan /
// nothing). The final answer text is discarded; the run row + transcript are
// the audit trail. Execution body shared with loop runs — see
// lib/unattended-run.ts and reference/automation-primitives.md §2.
export function createTriggeredRunProcessor(
  emitter: Emitter<ServerToClientEvents>,
  redis: RedisClient,
  respondQueue: Queue<MerlinRespondJobData>,
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
      const flushed = await flushActWindow(triggerId)
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
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, runId))
      .then((rows) => rows[0])
    if (!run?.triggerId) {
      logger.error({ runId }, "Triggered job without a run/trigger; skipping")
      return
    }

    // Kill switch, re-read at process time: disabling the trigger (or
    // clearing its instructions) between ack and execution cancels the run.
    const trigger = await db
      .select({
        enabled: schema.connectorTrigger.enabled,
        actInstructions: schema.connectorTrigger.actInstructions,
      })
      .from(schema.connectorTrigger)
      .where(eq(schema.connectorTrigger.id, run.triggerId))
      .then((rows) => rows[0])
    if (!trigger?.enabled || trigger.actInstructions === null) {
      await cancelPendingRun(runId)
      logger.info({ runId }, "Triggered run cancelled; trigger disabled")
      return
    }
    const triggerId = run.triggerId

    await runUnattended(
      { emitter, redis },
      {
        runId,
        channelId: run.channelId,
        label,
        payload,
        kind: "Triggered",
        triggered: {
          label,
          instructions: trigger.actInstructions,
          postMessage: (content) =>
            postMerlinChannelMessage(
              { emitter, redis },
              { channelId: run.channelId, content }
            ),
          createPlan: ({ title, goal }) =>
            createMerlinPlan(
              { emitter, redis, respondQueue },
              {
                workspaceId: run.workspaceId,
                channelId: run.channelId,
                title,
                goal,
                originRunId: runId,
              }
            ),
        },
        composeBriefing: () =>
          actRunBriefing({
            triggerId,
            channelId: run.channelId,
            runId,
          }),
      }
    )
  }
}
