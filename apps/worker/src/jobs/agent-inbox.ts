import {
  AGENT_COMPACT_JOB,
  AGENT_INBOX_CLASSIFY_JOB,
  AGENT_INBOX_FLUSH_JOB,
  AGENT_TURN_JOB,
  type AgentCompactJobData,
  type AgentInboxClassifyJobData,
  type AgentInboxFlushJobData,
  type AgentTurnJobData,
} from "@repo/realtime-types/queues"
import type { Job } from "bullmq"
import {
  type AgentDeps,
  type AgentQueueData,
  flushAgentInbox,
  runAgentCompactJob,
  runAgentTurnJob,
} from "@/lib/agent-inbox"
import { classifyInboxMessage } from "@/lib/agent-inbox-classify"
import { logger } from "@/lib/logger"

// The agents' queue: inbox flushes, turns and compactions, per conversation
// (reference/always-on-agents.md §3, §8).
export function createAgentInboxProcessor(deps: AgentDeps) {
  return async (job: Job<AgentQueueData>, token?: string) => {
    if (job.name === AGENT_TURN_JOB) {
      await runAgentTurnJob(deps, job as Job<AgentTurnJobData>, token)
      return
    }
    if (job.name === AGENT_COMPACT_JOB) {
      await runAgentCompactJob(deps, job as Job<AgentCompactJobData>, token)
      return
    }
    if (job.name === AGENT_INBOX_CLASSIFY_JOB) {
      // Queued by realtime and the API, never by the worker: not in
      // AgentQueueData, whose producers all pass a conversation.
      await classifyInboxMessage(
        deps,
        job.data as unknown as AgentInboxClassifyJobData
      )
      return
    }
    if (job.name !== AGENT_INBOX_FLUSH_JOB) {
      throw new Error(`Unknown agent inbox job: ${job.name}`)
    }
    const { conversationId } = job.data as AgentInboxFlushJobData
    // A job queued before conversations carries a channel id: nothing to read.
    if (!conversationId) return
    const outcome = await flushAgentInbox(deps, conversationId)
    logger.info({ conversationId, outcome }, "Agent inbox flushed")
  }
}
