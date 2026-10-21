import { env } from "@repo/env/server"
import {
  type DeleteSessionSandboxJobData,
  deleteSessionSandboxJob,
  MAINTENANCE_QUEUE,
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

let maintenanceQueue: Queue<DeleteSessionSandboxJobData> | null = null
function getMaintenanceQueue(): Queue<DeleteSessionSandboxJobData> {
  maintenanceQueue ??= new Queue<DeleteSessionSandboxJobData>(
    MAINTENANCE_QUEUE,
    {
      connection: {
        ...parseRedisUrl(env.REDIS_URL),
        maxRetriesPerRequest: null,
      },
    }
  )
  return maintenanceQueue
}

// The worker deletes the sandbox once the undo window passes, if the session
// is still archived then.
export async function enqueueSessionSandboxDelete(
  data: DeleteSessionSandboxJobData
): Promise<void> {
  const job = deleteSessionSandboxJob(data)
  await getMaintenanceQueue().add(job.name, job.data, job.opts)
}
