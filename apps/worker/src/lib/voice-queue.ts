import { env } from "@repo/env/server"
import {
  VOICE_REQUEST_QUEUE,
  type VoiceApprovalWatchJobData,
  type VoiceRequestJobData,
  type VoiceSessionMemoryJobData,
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
