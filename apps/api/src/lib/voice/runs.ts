import { and, db, eq, inArray, schema, sql } from "@repo/db"
import { env } from "@repo/env/server"
import {
  AGENT_RUN_STOP_CHANNEL,
  VOICE_REQUEST_JOB,
  VOICE_REQUEST_QUEUE,
  type VoiceRequestJobData,
  type VoiceSessionMemoryJobData,
  voiceSessionMemoryJob,
} from "@repo/realtime-types/queues"
import { Queue } from "bullmq"
import { getRedisClient } from "@/lib/redis"

const { agentRun } = schema

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

let voiceQueue: Queue<VoiceRequestJobData | VoiceSessionMemoryJobData> | null =
  null
function getVoiceQueue() {
  voiceQueue ??= new Queue(VOICE_REQUEST_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
  })
  return voiceQueue
}

// A call the API ended (a join found it expired) gets its summary and index.
export async function enqueueCallMemory(sessionId: string) {
  const job = voiceSessionMemoryJob(sessionId)
  await getVoiceQueue().add(job.name, job.data, job.opts)
}

// A clicked choice becomes a request; the worker runs it like a spoken one.
// With `resumeApprovalId`, a request paused on that approval continues.
export async function enqueueVoiceRequest(
  requestId: string,
  resumeApprovalId?: string
) {
  await getVoiceQueue().add(
    VOICE_REQUEST_JOB,
    resumeApprovalId ? { requestId, resumeApprovalId } : { requestId },
    {
      // BullMQ rejects ":" in custom ids.
      jobId: resumeApprovalId ? `${requestId}-${resumeApprovalId}` : requestId,
      attempts: 2,
      backoff: { type: "fixed", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: { age: 86_400 },
    }
  )
}

// Stops a cancelled voice request's run. A run no worker has claimed yet
// settles here; a working one is flagged and its worker signalled, like a
// stop from chat. Voice runs have no placeholder message to settle.
export async function stopVoiceRun(runId: string, userId: string) {
  const now = new Date()
  const [settled] = await db
    .update(agentRun)
    .set({
      state: "stopped",
      stopReason: "stopped_by_user",
      stopRequestedAt: now,
      stopRequestedBy: userId,
      finishedAt: now,
    })
    .where(and(eq(agentRun.id, runId), eq(agentRun.state, "queued")))
    .returning({ id: agentRun.id })
  if (settled) return

  const [flagged] = await db
    .update(agentRun)
    .set({
      stopRequestedAt: sql`coalesce(${agentRun.stopRequestedAt}, now())`,
      stopRequestedBy: userId,
    })
    .where(
      and(
        eq(agentRun.id, runId),
        inArray(agentRun.state, ["working", "finalizing"])
      )
    )
    .returning({ id: agentRun.id })
  if (!flagged) return
  // Best effort: the flag is the durable fallback.
  await getRedisClient()
    .then((redis) => redis.publish(AGENT_RUN_STOP_CHANNEL, runId))
    .catch(() => {})
}
