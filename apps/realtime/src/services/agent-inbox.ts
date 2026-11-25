import { db, eq, schema } from "@repo/db"
import { addInboxMessage, agentInThread } from "@repo/lor/channel-agent"
import type { RealtimeMessage } from "@repo/realtime-types"
import {
  AGENT_INBOX_BATCH_MS,
  AGENT_INBOX_FLUSH_JOB,
  type AgentInboxFlushJobData,
} from "@repo/realtime-types/queues"
import type { Queue } from "bullmq"
import { isLorMentioned, isReplyToLor } from "@/services/lor-routing"

// A message in the channel chat lands in the inbox of the agent in that
// channel (reference/always-on-agents.md §3). A mention or a reply to the
// agent wakes it; anything else waits unread until its next turn
// (reference/agents-and-chats.md, decision 8: no "every message" setting).
// In a human thread a mention or a reply to the agent reaches it, and so
// does every message in a thread it's part of (it may stay quiet); the agent
// answers in that thread. What wakes it goes to its request's conversation,
// so two people asking at once don't share a queue; what waits goes to the
// agent's own conversation, for its check-in (reference/agents-and-chats.md,
// decisions 26 and 28). A channel with no agent is plain human chat: nothing
// is queued.
export async function addChatMessageToAgentInbox(args: {
  workspaceId: string
  channelId: string
  message: RealtimeMessage
  queue: Queue<AgentInboxFlushJobData>
  // "addressed": a mention of Lor or a reply to it, which always wakes it.
  // "skipped": a thread reply not for the agent.
}): Promise<"addressed" | "wake" | "wait" | "duplicate" | "skipped"> {
  const [placed] = await db
    .select({ agentId: schema.channelAgent.agentId })
    .from(schema.channelAgent)
    .where(eq(schema.channelAgent.channelId, args.channelId))
    .limit(1)
  if (!placed) return "skipped"
  const threadRootId = args.message.threadRootId
  const addressed =
    isLorMentioned(args.message.content) ||
    isReplyToLor(args.message.referencedMessage)
  const inThread =
    threadRootId && !addressed ? await agentInThread(threadRootId) : false
  if (threadRootId && !addressed && !inThread) return "skipped"
  const lane = addressed || inThread ? "wake" : "wait"
  const conversationId = await addInboxMessage({
    workspaceId: args.workspaceId,
    channelId: args.channelId,
    messageId: args.message.id,
    lane,
  })
  if (!conversationId) return "duplicate"
  if (lane === "wake") {
    // A short delay, so quick messages in a row become one turn.
    await args.queue.add(
      AGENT_INBOX_FLUSH_JOB,
      { conversationId },
      { delay: AGENT_INBOX_BATCH_MS }
    )
  }
  return addressed ? "addressed" : lane
}
