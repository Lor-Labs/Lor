import { env } from "@repo/env/server"
import { setRepoCacheStore } from "@repo/merlin/github"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  AGENT_RUN_STOP_CHANNEL,
  LINK_UNFURL_QUEUE,
  MERLIN_RESPOND_QUEUE,
  type MerlinRespondJobData,
} from "@repo/realtime-types/queues"
import { Emitter } from "@socket.io/redis-emitter"
import { Queue, Worker } from "bullmq"
import { createClient } from "redis"
import { createLinkUnfurlProcessor } from "@/jobs/link-unfurl"
import { createMerlinRespondProcessor } from "@/jobs/merlin-respond"
import {
  DEAD_RUN_SWEEP_EVERY_MS,
  pruneRunEvents,
  RUN_EVENT_PRUNE_EVERY_MS,
  sweepDeadRuns,
} from "@/jobs/prune-run-events"
import { signalRunStop } from "@/lib/agent-run"
import { logger } from "@/lib/logger"

// Worker-internal periodic upkeep, scheduled through BullMQ (not in-process
// timers) so replicas share one schedule and runs are visible/retryable.
const MAINTENANCE_QUEUE = "maintenance"

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

async function bootstrap() {
  // Redis client for Socket.IO emitter (uses `redis` v4 package)
  const redisEmitterClient = createClient({ url: env.REDIS_URL })
  redisEmitterClient.on("error", (error) => {
    logger.error({ err: error }, "Redis emitter error")
  })
  await redisEmitterClient.connect()

  // Back Merlin's GitHub repo-list cache with this Redis client (Merlin has no
  // Redis dependency of its own — it just calls this injected store). One GitHub
  // repos call per installation per hour instead of per turn.
  setRepoCacheStore({
    get: (key) => redisEmitterClient.get(key),
    set: async (key, value, ttlSeconds) => {
      await redisEmitterClient.set(key, value, { EX: ttlSeconds })
    },
  })

  const emitter = new Emitter<ServerToClientEvents>(redisEmitterClient)

  // Immediate-stop fast path: abort the in-flight model request for runs this
  // process holds a lease on. The stopRequestedAt flag stays the durable
  // fallback if a publish is missed.
  const stopSubscriber = redisEmitterClient.duplicate()
  stopSubscriber.on("error", (error) => {
    logger.error({ err: error }, "Redis stop subscriber error")
  })
  await stopSubscriber.connect()
  await stopSubscriber.subscribe(AGENT_RUN_STOP_CHANNEL, (runId) => {
    signalRunStop(runId)
  })

  // BullMQ uses ioredis internally — pass connection options, not an instance
  const redisOpts = parseRedisUrl(env.REDIS_URL)

  const linkUnfurlWorker = new Worker(
    LINK_UNFURL_QUEUE,
    createLinkUnfurlProcessor(emitter),
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
      concurrency: 5,
    }
  )

  linkUnfurlWorker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "Link-unfurl job failed")
  })

  linkUnfurlWorker.on("error", (error) => {
    logger.error(
      { queue: LINK_UNFURL_QUEUE, workerId: linkUnfurlWorker.id, err: error },
      "Link-unfurl worker error"
    )
  })

  // Producer handle on the same queue: the completion drain enqueues the
  // follow-up run for messages queued behind an active scope.
  const merlinRespondQueue = new Queue<MerlinRespondJobData>(
    MERLIN_RESPOND_QUEUE,
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
    }
  )

  const merlinRespondWorker = new Worker(
    MERLIN_RESPOND_QUEUE,
    createMerlinRespondProcessor(
      emitter,
      redisEmitterClient,
      merlinRespondQueue
    ),
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
      concurrency: 5,
    }
  )

  merlinRespondWorker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "Merlin-respond job failed")
  })

  merlinRespondWorker.on("error", (error) => {
    logger.error(
      {
        queue: MERLIN_RESPOND_QUEUE,
        workerId: merlinRespondWorker.id,
        err: error,
      },
      "Merlin-respond worker error"
    )
  })

  const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, {
    connection: {
      ...redisOpts,
      maxRetriesPerRequest: null,
    },
    defaultJobOptions: {
      removeOnComplete: { age: 86400, count: 100 },
      removeOnFail: { age: 86400, count: 100 },
    },
  })

  const maintenanceWorker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name === "prune-run-events") await pruneRunEvents()
      else if (job.name === "sweep-dead-runs")
        await sweepDeadRuns(emitter, merlinRespondQueue)
    },
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
      concurrency: 1,
    }
  )

  maintenanceWorker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "Maintenance job failed")
  })

  maintenanceWorker.on("error", (error) => {
    logger.error(
      { queue: MAINTENANCE_QUEUE, workerId: maintenanceWorker.id, err: error },
      "Maintenance worker error"
    )
  })

  // Upsert (idempotent across replicas/restarts): one shared schedule in
  // Redis, first run fires immediately, then every interval.
  await maintenanceQueue.upsertJobScheduler("prune-run-events", {
    every: RUN_EVENT_PRUNE_EVERY_MS,
  })
  await maintenanceQueue.upsertJobScheduler("sweep-dead-runs", {
    every: DEAD_RUN_SWEEP_EVERY_MS,
  })

  logger.info(
    { queues: [LINK_UNFURL_QUEUE, MERLIN_RESPOND_QUEUE, MAINTENANCE_QUEUE] },
    "Worker started"
  )

  const shutdown = async () => {
    logger.info("Shutting down...")
    await linkUnfurlWorker.close()
    await merlinRespondWorker.close()
    await merlinRespondQueue.close()
    await maintenanceWorker.close()
    await maintenanceQueue.close()
    await stopSubscriber.quit()
    await redisEmitterClient.quit()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, "Failed to start")
  process.exit(1)
})
