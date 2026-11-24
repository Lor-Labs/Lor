import { db, eq, schema } from "@repo/db"
import { addInboxMessage, agentInThread } from "@repo/lor/channel-agent"
import { ensureCheckInLoop } from "@repo/lor/check-in"
import { toRealtimeLoop } from "@repo/lor/loops"
import type { RealtimeMessage } from "@repo/realtime-types"
import {
  AGENT_INBOX_BATCH_MS,
  AGENT_INBOX_FLUSH_JOB,
  type AgentInboxFlushJobData,
} from "@repo/realtime-types/queues"
import type { Queue } from "bullmq"
import { logger } from "@/lib/logger"
import { isLorMentioned, isReplyToLor } from "@/services/lor-routing"

// Channels whose check-in this process already made sure of.
const checkedIn = new Set<string>()

// A channel's agent comes with its check-in (always-on-agents.md, decision
// 7). Channels made before it get theirs on their next message.
function ensureCheckIn(
  channelId: string,
  onMade: (loop: ReturnType<typeof toRealtimeLoop>) => void
) {
  if (checkedIn.has(channelId)) return
  checkedIn.add(channelId)
  void ensureCheckInLoop(channelId)
    .then((loop) => {
      if (loop) onMade(toRealtimeLoop(loop))
    })
    .catch((err) => {
      checkedIn.delete(channelId)
      logger.warn({ err, channelId }, "Check-in Loop failed")
    })
}

// A message in the channel chat lands in the inbox of the agent in that
// channel (reference/always-on-agents.md §3). A mention or a reply to the
// agent wakes it; anything else waits unread until its next turn
// (reference/agents-and-chats.md, decision 8: no "every message" setting).
// In a human thread a mention or a reply to the agent reaches it, and so
// does every message in a thread it's part of (it may stay quiet); the agent
// answers in that thread. A channel with no agent is plain human chat:
// nothing is queued.
export async function addChatMessageToAgentInbox(args: {
  workspaceId: string
  channelId: string
  message: RealtimeMessage
  queue: Queue<AgentInboxFlushJobData>
  // Tells the channel about a check-in Loop made for it just now.
  onCheckInMade: (loop: ReturnType<typeof toRealtimeLoop>) => void
  // "addressed": a mention of Lor or a reply to it, which always wakes it.
  // "skipped": a thread reply not for the agent.
}): Promise<"addressed" | "wake" | "wait" | "duplicate" | "skipped"> {
  const [channel] = await db
    .select({ agentId: schema.channel.agentId })
    .from(schema.channel)
    .where(eq(schema.channel.id, args.channelId))
  if (!channel?.agentId) return "skipped"
  ensureCheckIn(args.channelId, args.onCheckInMade)
  const threadRootId = args.message.threadRootId
  const addressed =
    isLorMentioned(args.message.content) ||
    isReplyToLor(args.message.referencedMessage)
  const inThread =
    threadRootId && !addressed ? await agentInThread(threadRootId) : false
  if (threadRootId && !addressed && !inThread) return "skipped"
  const lane = addressed || inThread ? "wake" : "wait"
  const added = await addInboxMessage({
    workspaceId: args.workspaceId,
    channelId: args.channelId,
    messageId: args.message.id,
    lane,
  })
  if (!added) return "duplicate"
  if (lane === "wake") {
    // A short delay, so quick messages in a row become one turn.
    await args.queue.add(
      AGENT_INBOX_FLUSH_JOB,
      { channelId: args.channelId },
      { delay: AGENT_INBOX_BATCH_MS }
    )
  }
  return addressed ? "addressed" : lane
}
