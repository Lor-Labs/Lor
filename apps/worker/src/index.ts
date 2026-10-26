import "./instrumentation"
import { env } from "@repo/env/server"
import { flushErrorReports } from "@repo/logger"
import { claimOverdueActWindows } from "@repo/lor/act-runs"
import { sweepCheckpointStorage } from "@repo/lor/code-checkpoints"
import { setRepoCacheStore } from "@repo/lor/github"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  ACT_FLUSH_JOB,
  type ActFlushJobData,
  AGENT_RUN_STOP_CHANNEL,
  ATTACHMENT_INDEX_QUEUE,
  DELETE_SESSION_SANDBOX_JOB,
  type DeleteSessionSandboxJobData,
  LINK_UNFURL_QUEUE,
  LOOP_RUN_QUEUE,
  LOR_RESPOND_QUEUE,
  type LoopRunJobData,
  type LorRespondJobData,
  PROJECT_ARCHIVE_QUEUE,
  type ProjectArchiveJobData,
  SOURCE_INGEST_QUEUE,
  type SourceIngestJobData,
  TRIGGERED_RUN_QUEUE,
  type TriggeredRunJobData,
  VOICE_REQUEST_QUEUE,
  type VoiceApprovalWatchJobData,
  type VoiceRequestJobData,
} from "@repo/realtime-types/queues"
import { Emitter } from "@socket.io/redis-emitter"
import { Queue, Worker } from "bullmq"
import { createClient } from "redis"
import { createAttachmentIndexProcessor } from "@/jobs/attachment-index"
import { createLinkUnfurlProcessor } from "@/jobs/link-unfurl"
import { createLoopRunProcessor } from "@/jobs/loop-run"
import { createLorRespondProcessor } from "@/jobs/lor-respond"
import { createProjectArchiveProcessor } from "@/jobs/project-archive"
import {
  DEAD_RUN_SWEEP_EVERY_MS,
  pruneRunEvents,
  RUN_EVENT_PRUNE_EVERY_MS,
  sweepDeadRuns,
  sweepOrphanedPlaceholders,
} from "@/jobs/prune-run-events"
import { createSourceIngestProcessor } from "@/jobs/source-ingest"
import { LOOP_SWEEP_EVERY_MS, sweepDueLoops } from "@/jobs/sweep-due-loops"
import { createTriggeredRunProcessor } from "@/jobs/triggered-run"
import { createVoiceRequestProcessor } from "@/jobs/voice-request"
import {
  auditVoiceSessions,
  sweepVoiceSessions,
  VOICE_SESSION_AUDIT_EVERY_MS,
  VOICE_SESSION_SWEEP_EVERY_MS,
} from "@/jobs/voice-sessions"
import { signalRunStop } from "@/lib/agent-run"
import {
  escalateApproval,
  MAINTENANCE_QUEUE,
  NOTIFY_APPROVAL_JOB,
  parseRedisUrl,
} from "@/lib/approval-notify"
import { logger } from "@/lib/logger"
import { awaitInflightDrains } from "@/lib/run-queue"
import {
  deleteArchivedSessionSandbox,
  RELEASE_PARKED_BRIDGE_JOB,
  type ReleaseParkedBridgeJobData,
  releaseParkedBridge,
} from "@/lib/session-sandboxes"
import { installVoiceNotifier } from "@/lib/voice-notify"
import { setWorkspaceActivityEmitter } from "@/lib/workspace-activity"

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection")
})

// Worker-internal periodic upkeep and delayed one-shots, scheduled through
// BullMQ (not in-process timers) so replicas share one schedule and runs are
// visible/retryable. The queue name lives in approval-notify (its producer).
// A lost flush job is the only way queued Act deliveries can go unhandled, so
// sweep for open-but-overdue windows and re-arm them.
const ACT_WINDOW_SWEEP_EVERY_MS = 5 * 60 * 1000
const ACT_WINDOW_SWEEP_GRACE_MS = 60 * 1000
// Deleted sessions and workspaces leave checkpoints in Code Storage until
// this sweep (code-checkpoints.ts).
const CHECKPOINT_STORAGE_SWEEP_EVERY_MS = 24 * 60 * 60 * 1000

async function bootstrap() {
  // Redis client for Socket.IO emitter (uses `redis` v4 package)
  const redisEmitterClient = createClient({ url: env.REDIS_URL })
  redisEmitterClient.on("error", (error) => {
    logger.error({ err: error }, "Redis emitter error")
  })
  await redisEmitterClient.connect()

  // Back Lor's GitHub repo-list cache with this Redis client (Lor has no
  // Redis dependency of its own — it just calls this injected store). One GitHub
  // repos call per installation per hour instead of per turn.
  setRepoCacheStore({
    get: (key) => redisEmitterClient.get(key),
    set: async (key, value, ttlSeconds) => {
      await redisEmitterClient.set(key, value, { EX: ttlSeconds })
    },
  })

  const emitter = new Emitter<ServerToClientEvents>(redisEmitterClient)
  setWorkspaceActivityEmitter(emitter)
  installVoiceNotifier(emitter)

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

  const attachmentIndexWorker = new Worker(
    ATTACHMENT_INDEX_QUEUE,
    createAttachmentIndexProcessor(),
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
      concurrency: 2,
    }
  )

  attachmentIndexWorker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "Attachment-index job failed")
  })

  attachmentIndexWorker.on("error", (error) => {
    logger.error(
      {
        queue: ATTACHMENT_INDEX_QUEUE,
        workerId: attachmentIndexWorker.id,
        err: error,
      },
      "Attachment-index worker error"
    )
  })

  // Source ingestion. The limiter is one budget across connections; a
  // provider rate limit fails the job, and its backoff retries it later.
  const sourceIngestWorker = new Worker<SourceIngestJobData>(
    SOURCE_INGEST_QUEUE,
    createSourceIngestProcessor(),
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
      concurrency: 2,
      limiter: { max: 5, duration: 1000 },
    }
  )

  sourceIngestWorker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, data: job?.data, err: error },
      "Source-ingest job failed"
    )
  })

  sourceIngestWorker.on("error", (error) => {
    logger.error(
      {
        queue: SOURCE_INGEST_QUEUE,
        workerId: sourceIngestWorker.id,
        err: error,
      },
      "Source-ingest worker error"
    )
  })

  // Producer handle on the same queue: the completion drain enqueues the
  // follow-up run for messages queued behind an active scope.
  const lorRespondQueue = new Queue<LorRespondJobData>(LOR_RESPOND_QUEUE, {
    connection: {
      ...redisOpts,
      maxRetriesPerRequest: null,
    },
  })

  const lorRespondWorker = new Worker(
    LOR_RESPOND_QUEUE,
    createLorRespondProcessor(emitter, redisEmitterClient, lorRespondQueue),
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
      concurrency: 5,
    }
  )

  lorRespondWorker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "Lor-respond job failed")
  })

  lorRespondWorker.on("error", (error) => {
    logger.error(
      {
        queue: LOR_RESPOND_QUEUE,
        workerId: lorRespondWorker.id,
        err: error,
      },
      "Lor-respond worker error"
    )
  })

  // The Act effect: each prepared run starts a session and enqueues its
  // respond job. Its own queue re-arms a coalescing window that's waiting
  // on an in-flight run.
  const triggeredRunQueue = new Queue<TriggeredRunJobData | ActFlushJobData>(
    TRIGGERED_RUN_QUEUE,
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
    }
  )

  const triggeredRunWorker = new Worker(
    TRIGGERED_RUN_QUEUE,
    createTriggeredRunProcessor(
      emitter,
      redisEmitterClient,
      lorRespondQueue,
      triggeredRunQueue
    ),
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
      concurrency: 5,
    }
  )

  triggeredRunWorker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "Triggered-run job failed")
  })

  triggeredRunWorker.on("error", (error) => {
    logger.error(
      {
        queue: TRIGGERED_RUN_QUEUE,
        workerId: triggeredRunWorker.id,
        err: error,
      },
      "Triggered-run worker error"
    )
  })

  // Scheduled loop runs (reference/loops.md). Own queue — fairness isolation
  // from Act webhook bursts, independent scaling later. The maintenance
  // sweep is the producer.
  const loopRunQueue = new Queue<LoopRunJobData>(LOOP_RUN_QUEUE, {
    connection: {
      ...redisOpts,
      maxRetriesPerRequest: null,
    },
  })

  const loopRunWorker = new Worker(
    LOOP_RUN_QUEUE,
    createLoopRunProcessor(emitter, redisEmitterClient, lorRespondQueue),
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
      concurrency: 3,
    }
  )

  loopRunWorker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "Loop-run job failed")
  })

  loopRunWorker.on("error", (error) => {
    logger.error(
      { queue: LOOP_RUN_QUEUE, workerId: loopRunWorker.id, err: error },
      "Loop-run worker error"
    )
  })

  // Requests to Lor spoken in a call. The transcriber is the producer; the
  // worker itself schedules approval watchers and resumes.
  const voiceRequestWorker = new Worker<
    VoiceRequestJobData | VoiceApprovalWatchJobData
  >(
    VOICE_REQUEST_QUEUE,
    createVoiceRequestProcessor({ emitter, redis: redisEmitterClient }),
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
      concurrency: 5,
    }
  )

  voiceRequestWorker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "Voice-request job failed")
  })

  voiceRequestWorker.on("error", (error) => {
    logger.error(
      {
        queue: VOICE_REQUEST_QUEUE,
        workerId: voiceRequestWorker.id,
        err: error,
      },
      "Voice-request worker error"
    )
  })

  const projectArchiveWorker = new Worker<ProjectArchiveJobData>(
    PROJECT_ARCHIVE_QUEUE,
    createProjectArchiveProcessor(emitter),
    {
      connection: {
        ...redisOpts,
        maxRetriesPerRequest: null,
      },
      concurrency: 2,
    }
  )

  projectArchiveWorker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "Project-archive job failed")
  })

  projectArchiveWorker.on("error", (error) => {
    logger.error(
      {
        queue: PROJECT_ARCHIVE_QUEUE,
        workerId: projectArchiveWorker.id,
        err: error,
      },
      "Project-archive worker error"
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
      else if (job.name === "sweep-dead-runs") {
        await sweepDeadRuns(
          emitter,
          redisEmitterClient,
          lorRespondQueue,
          triggeredRunQueue
        )
        await sweepOrphanedPlaceholders(emitter)
      } else if (job.name === "sweep-due-loops")
        await sweepDueLoops(emitter, loopRunQueue)
      else if (job.name === "sweep-voice-sessions") await sweepVoiceSessions()
      else if (job.name === "sweep-checkpoint-storage") {
        const swept = await sweepCheckpointStorage()
        logger.info(swept, "Checkpoint storage swept")
      } else if (job.name === DELETE_SESSION_SANDBOX_JOB) {
        await deleteArchivedSessionSandbox(
          job.data as DeleteSessionSandboxJobData
        )
      } else if (job.name === RELEASE_PARKED_BRIDGE_JOB) {
        await releaseParkedBridge(job.data as ReleaseParkedBridgeJobData)
      } else if (job.name === "audit-voice-sessions") await auditVoiceSessions()
      else if (job.name === NOTIFY_APPROVAL_JOB) {
        const { approvalId } = job.data as { approvalId: string }
        await escalateApproval(
          { emitter, redis: redisEmitterClient },
          approvalId
        )
      } else if (job.name === "sweep-act-windows") {
        // Claimed, so a slow re-armed flush can't be double-enqueued.
        const overdue = await claimOverdueActWindows(ACT_WINDOW_SWEEP_GRACE_MS)
        for (const triggerId of overdue) {
          logger.warn({ triggerId }, "Act flush overdue; re-arming")
          await triggeredRunQueue.add(
            ACT_FLUSH_JOB,
            { triggerId },
            { attempts: 2, removeOnComplete: true }
          )
        }
      }
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
  await maintenanceQueue.upsertJobScheduler("sweep-act-windows", {
    every: ACT_WINDOW_SWEEP_EVERY_MS,
  })
  await maintenanceQueue.upsertJobScheduler("sweep-due-loops", {
    every: LOOP_SWEEP_EVERY_MS,
  })
  await maintenanceQueue.upsertJobScheduler("sweep-voice-sessions", {
    every: VOICE_SESSION_SWEEP_EVERY_MS,
  })
  await maintenanceQueue.upsertJobScheduler("sweep-checkpoint-storage", {
    every: CHECKPOINT_STORAGE_SWEEP_EVERY_MS,
  })
  await maintenanceQueue.upsertJobScheduler("audit-voice-sessions", {
    every: VOICE_SESSION_AUDIT_EVERY_MS,
  })

  logger.info(
    {
      queues: [
        LINK_UNFURL_QUEUE,
        ATTACHMENT_INDEX_QUEUE,
        SOURCE_INGEST_QUEUE,
        LOR_RESPOND_QUEUE,
        TRIGGERED_RUN_QUEUE,
        LOOP_RUN_QUEUE,
        VOICE_REQUEST_QUEUE,
        PROJECT_ARCHIVE_QUEUE,
        MAINTENANCE_QUEUE,
      ],
    },
    "Worker started"
  )

  const shutdown = async () => {
    logger.info("Shutting down...")
    await linkUnfurlWorker.close()
    await attachmentIndexWorker.close()
    await sourceIngestWorker.close()
    await lorRespondWorker.close()
    await triggeredRunWorker.close()
    await loopRunWorker.close()
    await voiceRequestWorker.close()
    await projectArchiveWorker.close()
    // The dead-run sweep also drains scopes — close it before waiting so no
    // new drain can start after the wait completes.
    await maintenanceWorker.close()
    // Completion drains are fire-and-forget from the processor — finish any
    // in flight before closing the queue they enqueue follow-up runs on.
    await awaitInflightDrains()
    await lorRespondQueue.close()
    await triggeredRunQueue.close()
    await loopRunQueue.close()
    await maintenanceQueue.close()
    await stopSubscriber.quit()
    await redisEmitterClient.quit()
    await flushErrorReports()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

bootstrap().catch(async (error) => {
  logger.fatal({ err: error }, "Failed to start")
  await flushErrorReports()
  process.exit(1)
})
