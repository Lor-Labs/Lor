import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type {
  AgentInboxFlushJobData,
  LorRespondJobData,
} from "@repo/realtime-types/queues"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job, Queue } from "bullmq"
import type { createClient } from "redis"
import { flushAgentInbox } from "@/lib/agent-inbox"
import { logger } from "@/lib/logger"

type RedisClient = ReturnType<typeof createClient>

// A flush of one channel's agent inbox. Cheap when there is nothing to do:
// several flushes for quick messages in a row find the same pending items,
// the first starts the turn and the rest find none.
export function createAgentInboxProcessor(
  emitter: Emitter<ServerToClientEvents>,
  redis: RedisClient,
  respondQueue: Queue<LorRespondJobData>
) {
  return async (job: Job<AgentInboxFlushJobData>) => {
    const { channelId } = job.data
    const outcome = await flushAgentInbox(
      { emitter, redis, respondQueue },
      channelId
    )
    logger.info({ channelId, outcome }, "Agent inbox flushed")
  }
}
