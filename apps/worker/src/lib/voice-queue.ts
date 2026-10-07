import { env } from "@repo/env/server"
import {
  VOICE_REQUEST_QUEUE,
  type VoiceApprovalWatchJobData,
  type VoiceRequestJobData,
  type VoiceSessionMemoryJobData,
  voiceSessionMemoryJob,
} from "@repo/realtime-types/queues"
import { Queue } from "bullmq"
import { parseRedisUrl } from "@/lib/approval-notify"

// The worker's own producer for the voice queue: approval watchers and
// resumes, and after-call memory jobs.
let voiceQueue: Queue<
  VoiceRequestJobData | VoiceApprovalWatchJobData | VoiceSessionMemoryJobData
> | null = null

export function getVoiceQueue() {
  voiceQueue ??= new Queue(VOICE_REQUEST_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
  })
  return voiceQueue
}

export async function enqueueCallMemory(sessionId: string) {
  const job = voiceSessionMemoryJob(sessionId)
  await getVoiceQueue().add(job.name, job.data, job.opts)
}
