import { env } from "@repo/env/server"
import {
  PROJECT_ARCHIVE_QUEUE,
  type ProjectArchiveJobData,
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

let archiveQueue: Queue<ProjectArchiveJobData> | null = null
function getArchiveQueue(): Queue<ProjectArchiveJobData> {
  archiveQueue ??= new Queue<ProjectArchiveJobData>(PROJECT_ARCHIVE_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
    defaultJobOptions: {
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 7 * 86400, count: 1000 },
    },
  })
  return archiveQueue
}

// jobId = projectId: archiving is one-shot per project, so a double-click or
// handler retry can't enqueue two synthesis runs.
export async function enqueueProjectArchive(projectId: string): Promise<void> {
  await getArchiveQueue().add(
    "archive",
    { projectId },
    {
      jobId: projectId,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
    }
  )
}
