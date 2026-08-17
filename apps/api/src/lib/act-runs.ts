import { and, count, db, eq, gte, schema } from "@repo/db"
import { env } from "@repo/env/server"
import {
  TRIGGERED_RUN_QUEUE,
  type TriggeredRunJobData,
} from "@repo/realtime-types/queues"
import { Queue } from "bullmq"
import { logger } from "@/lib/logger"

// Act payloads ride the BullMQ job (first-party event content isn't stored
// anywhere Lor can re-read); keep them well under Redis discomfort.
const ACT_PAYLOAD_MAX = 48 * 1024
// Rolling window for the per-trigger daily run cap.
const RUN_CAP_WINDOW_MS = 24 * 60 * 60 * 1000

function parseRedisUrl(url: string) {
  const parsed = new URL(url)
  const dbIndex = Number.parseInt(parsed.pathname.slice(1), 10)
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    db: Number.isFinite(dbIndex) ? dbIndex : 0,
  }
}

let triggeredRunQueue: Queue<TriggeredRunJobData> | null = null
function getTriggeredRunQueue(): Queue<TriggeredRunJobData> {
  triggeredRunQueue ??= new Queue<TriggeredRunJobData>(TRIGGERED_RUN_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400, count: 5000 },
    },
  })
  return triggeredRunQueue
}

// Start the Act effect for one delivery: a headless agent run (no placeholder
// message; scopeKey = deliveryId so deliveries never contend) with trigger
// provenance, enqueued for the worker. Best-effort — a failure here must
// never break the webhook ack; returns the run id or null.
// See reference/automation-primitives.md §2 (Act) and §5 (guardrails).
export async function startActRun(input: {
  triggerId: string
  deliveryId: string
  dailyRunCap: number
  workspaceId: string
  channelId: string
  label: string
  payload: string
}): Promise<string | null> {
  try {
    // Daily cap — the backstop for triggers whose instructions usually say
    // "do nothing" but still burn a model call per delivery.
    const since = new Date(Date.now() - RUN_CAP_WINDOW_MS)
    const recent = await db
      .select({ value: count() })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.triggerId, input.triggerId),
          gte(schema.agentRun.createdAt, since)
        )
      )
      .then((rows) => rows[0]?.value ?? 0)
    if (recent >= input.dailyRunCap) {
      logger.warn(
        { triggerId: input.triggerId, cap: input.dailyRunCap },
        "Act skipped; trigger hit its daily run cap"
      )
      return null
    }

    const run = await db
      .insert(schema.agentRun)
      .values({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        scopeKey: input.deliveryId,
        triggerId: input.triggerId,
        deliveryId: input.deliveryId,
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
    if (!run) return null

    await db
      .update(schema.triggerDelivery)
      .set({ runId: run.id })
      .where(eq(schema.triggerDelivery.id, input.deliveryId))
      .catch(() => {})

    try {
      await getTriggeredRunQueue().add(
        "act",
        {
          runId: run.id,
          payload: input.payload.slice(0, ACT_PAYLOAD_MAX),
          label: input.label,
        },
        {
          attempts: 2,
          backoff: { type: "fixed", delay: 5000 },
          jobId: run.id,
        }
      )
    } catch (err) {
      // No job means the run can never execute — remove it so it doesn't
      // linger pending or count against the trigger's daily cap (mirrors
      // task-runs' enqueue-failure cleanup).
      logger.error(
        { err, runId: run.id, triggerId: input.triggerId },
        "Act run enqueue failed"
      )
      await db
        .update(schema.triggerDelivery)
        .set({ runId: null })
        .where(eq(schema.triggerDelivery.id, input.deliveryId))
        .catch(() => {})
      await db
        .delete(schema.agentRun)
        .where(eq(schema.agentRun.id, run.id))
        .catch(() => {})
      return null
    }
    return run.id
  } catch (err) {
    logger.error(
      { err, triggerId: input.triggerId, deliveryId: input.deliveryId },
      "Act run start failed"
    )
    return null
  }
}
