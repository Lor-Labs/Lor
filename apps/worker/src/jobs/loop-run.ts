import { db, eq, schema } from "@repo/db"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type {
  LoopRunJobData,
  LorRespondJobData,
} from "@repo/realtime-types/queues"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job, Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { fireLoop } from "@/lib/loop-session"
import { cancelPendingRun } from "@/lib/unattended-run"

type RedisClient = ReturnType<typeof createClient>

// One loop fire, from the sweep or "Run now": the kill switch is re-read at
// process time, then the fire becomes a turn in the loop's session.
export function createLoopRunProcessor(
  emitter: Emitter<ServerToClientEvents>,
  redis: RedisClient,
  respondQueue: Queue<LorRespondJobData>
) {
  return async (job: Job<LoopRunJobData>) => {
    const { loopId } = job.data
    if (job.data.runId) await cancelPendingRun(job.data.runId)

    const loop = await db
      .select()
      .from(schema.loop)
      .where(eq(schema.loop.id, loopId))
      .then((rows) => rows[0])
    if (!loop || loop.status !== "active") {
      logger.info({ loopId }, "Loop fire skipped; loop not active")
      return
    }

    const outcome = await fireLoop(
      { emitter, redis, respondQueue },
      loop,
      job.data.scheduledFor ? new Date(job.data.scheduledFor) : new Date()
    )
    logger.info({ loopId, outcome }, "Loop fired")
  }
}
