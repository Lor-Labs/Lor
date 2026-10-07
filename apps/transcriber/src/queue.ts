import { env } from "@repo/env/server"
import {
  VOICE_REQUEST_JOB,
  VOICE_REQUEST_QUEUE,
  type VoiceRequestJobData,
} from "@repo/realtime-types/queues"
import { Queue } from "bullmq"

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

// Created on first use, like the emitter: most calls never address Lor.
let queue: Queue<VoiceRequestJobData> | null = null

// Hands an accepted request to the worker, which runs it.
export async function enqueueVoiceRequest(requestId: string) {
  queue ??= new Queue<VoiceRequestJobData>(VOICE_REQUEST_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
  })
  await queue.add(
    VOICE_REQUEST_JOB,
    { requestId },
    {
      jobId: requestId,
      attempts: 2,
      backoff: { type: "fixed", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: { age: 86_400 },
    }
  )
}

export async function closeQueue() {
  await queue?.close().catch(() => undefined)
}
