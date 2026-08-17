import { db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import {
  actGuard,
  closeActWindow,
  createActRun,
  openActWindow,
} from "@repo/merlin/act-runs"
import {
  ACT_FLUSH_JOB,
  ACT_RUN_JOB,
  type ActFlushJobData,
  TRIGGERED_RUN_QUEUE,
  type TriggeredRunJobData,
} from "@repo/realtime-types/queues"
import { Queue } from "bullmq"
import { logger } from "@/lib/logger"

// Act payloads ride the BullMQ job in immediate mode (first-party event
// content isn't stored anywhere Lor can re-read); keep them well under Redis
// discomfort. Batched runs rebuild their payload from trigger_delivery.
const ACT_PAYLOAD_MAX = 48 * 1024

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

let triggeredRunQueue: Queue<TriggeredRunJobData | ActFlushJobData> | null =
  null
function getTriggeredRunQueue(): Queue<TriggeredRunJobData | ActFlushJobData> {
  triggeredRunQueue ??= new Queue<TriggeredRunJobData | ActFlushJobData>(
    TRIGGERED_RUN_QUEUE,
    {
      connection: {
        ...parseRedisUrl(env.REDIS_URL),
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 5000 },
      },
    }
  )
  return triggeredRunQueue
}

export type ActStart =
  // A run was created and enqueued now.
  | { kind: "started"; runId: string }
  // Nothing is dropped for being blocked: the delivery is in the trigger's
  // queue and the next flush picks it up (alone or with the rest of a burst).
  | { kind: "queued"; reason: string }
  | { kind: "skipped"; reason: string }

// While a run is in flight, an immediate-mode trigger still has to hold its
// deliveries somewhere — it borrows the batch machinery with a short window.
const IMMEDIATE_QUEUE_WINDOW_SECONDS = 30

// Start (or defer) the Act effect for one delivery. Best-effort — a failure
// here must never break the webhook ack.
// See reference/automation-primitives.md §2 (Act) and §5 (guardrails).
export async function startActRun(input: {
  triggerId: string
  deliveryId: string
  windowSeconds: number
  hourlyRunCap: number
  dailyRunCap: number
  workspaceId: string
  channelId: string
  label: string
  payload: string
}): Promise<ActStart> {
  try {
    if (input.windowSeconds === 0) {
      const now = await runActNow(input)
      if (now.kind === "started") return now
      // Blocked by an in-flight run or a spent cap — queue rather than drop.
      if (now.blocked) {
        await armActFlush(
          input.triggerId,
          IMMEDIATE_QUEUE_WINDOW_SECONDS,
          IMMEDIATE_QUEUE_WINDOW_SECONDS
        )
        return { kind: "queued", reason: now.reason }
      }
      return now
    }

    // Batching is leading-edge: the first delivery of a quiet period runs
    // immediately (a lone event must never sit out the window), and the window
    // opens behind it so everything arriving during the investigation
    // coalesces into one follow-up instead of a run each.
    const armed = await armActFlush(
      input.triggerId,
      input.windowSeconds,
      input.windowSeconds
    )
    if (!armed) return { kind: "queued", reason: "window_open" }

    const leading = await runActNow(input)
    if (leading.kind === "started") return leading
    // A run is already going, or the caps are spent — the flush picks this
    // delivery up with whatever else the window collects.
    logger.info(
      { triggerId: input.triggerId, reason: leading.reason },
      "Act leading edge deferred to the batch"
    )
    return { kind: "queued", reason: leading.reason }
  } catch (err) {
    logger.error(
      { err, triggerId: input.triggerId, deliveryId: input.deliveryId },
      "Act run start failed"
    )
    return { kind: "skipped", reason: "error" }
  }
}

// Open the trigger's window (if it isn't already) and schedule the flush that
// drains it. Returns false when a window — and therefore a flush — is already
// pending, which is all a joining delivery needs.
async function armActFlush(
  triggerId: string,
  delaySeconds: number,
  staleAfterSeconds: number
): Promise<boolean> {
  const openedAt = await openActWindow(triggerId, staleAfterSeconds)
  if (!openedAt) return false
  try {
    await getTriggeredRunQueue().add(
      ACT_FLUSH_JOB,
      { triggerId },
      {
        delay: delaySeconds * 1000,
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
        // Removed promptly: the open-window row is the dedupe, and a lingering
        // completed job would only confuse the queue's counts.
        removeOnComplete: true,
      }
    )
  } catch (err) {
    // An open window with no flush job behind it blocks re-arming until the
    // recovery sweep notices; release it so the next delivery can arm again.
    await closeActWindow(triggerId)
    logger.error({ err, triggerId }, "Act flush enqueue failed")
    throw err
  }
  return true
}

// One delivery, one run, right now: guards, run row, then the job. `blocked`
// separates "a run is already going / cap spent" (queue it) from a real
// failure (nothing more to try).
async function runActNow(input: {
  triggerId: string
  deliveryId: string
  hourlyRunCap: number
  dailyRunCap: number
  workspaceId: string
  channelId: string
  label: string
  payload: string
}): Promise<
  | { kind: "started"; runId: string }
  | { kind: "skipped"; reason: string; blocked?: boolean }
> {
  const guard = await actGuard(input.triggerId, input)
  if (guard.verdict !== "ok") {
    return { kind: "skipped", reason: guard.verdict, blocked: true }
  }

  const run = await createActRun(input)
  if (run === "in_flight") {
    return { kind: "skipped", reason: "in_flight", blocked: true }
  }
  if (!run) return { kind: "skipped", reason: "run_insert_failed" }

  await db
    .update(schema.triggerDelivery)
    .set({ runId: run.id })
    .where(eq(schema.triggerDelivery.id, input.deliveryId))
    .catch((err) => {
      // The run still executes; the delivery just isn't linked to it, so a
      // later flush may re-batch it.
      logger.warn(
        { err, runId: run.id, deliveryId: input.deliveryId },
        "Act delivery link failed"
      )
    })

  try {
    await getTriggeredRunQueue().add(
      ACT_RUN_JOB,
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
    // linger pending or count against the trigger's caps (mirrors
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
    return { kind: "skipped", reason: "enqueue_failed" }
  }
  return { kind: "started", runId: run.id }
}
