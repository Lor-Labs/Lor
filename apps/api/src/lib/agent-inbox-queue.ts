import { env } from "@repo/env/server"
import {
  AGENT_INBOX_FLUSH_JOB,
  AGENT_INBOX_QUEUE,
  type AgentInboxFlushJobData,
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

let agentInboxQueue: Queue<AgentInboxFlushJobData> | null = null
function getAgentInboxQueue(): Queue<AgentInboxFlushJobData> {
  agentInboxQueue ??= new Queue<AgentInboxFlushJobData>(AGENT_INBOX_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400, count: 5000 },
    },
  })
  return agentInboxQueue
}

// The channel agent reads its inbox again: a decided approval set lets its
// paused turn go on, and a trigger's event wakes it
// (reference/always-on-agents.md §3, §5).
export async function flushAgentInbox(
  channelId: string,
  delayMs = 0
): Promise<void> {
  await getAgentInboxQueue().add(
    AGENT_INBOX_FLUSH_JOB,
    { channelId },
    delayMs > 0 ? { delay: delayMs } : {}
  )
}
