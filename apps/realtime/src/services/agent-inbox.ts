import { db, eq, LOR_USER_ID, schema } from "@repo/db"
import { addInboxMessage } from "@repo/lor/channel-agent"
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

async function threadRootIsLor(threadRootId: string): Promise<boolean> {
  const [root] = await db
    .select({ authorId: schema.message.authorId })
    .from(schema.message)
    .where(eq(schema.message.id, threadRootId))
  return root?.authorId === LOR_USER_ID
}

// A message in the channel chat lands in the channel agent's inbox
// (reference/always-on-agents.md §3). A mention or a reply to the
// agent wakes it; anything else waits unread until its next turn, unless the
// channel is set to wake it on every message. In a human thread only a
// mention, a reply to the agent, or a reply in a thread under one of its
// messages reaches it, and the agent answers in that thread.
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
  ensureCheckIn(args.channelId, args.onCheckInMade)
  const threadRootId = args.message.threadRootId
  const addressed =
    isLorMentioned(args.message.content) ||
    isReplyToLor(args.message.referencedMessage) ||
    (threadRootId ? await threadRootIsLor(threadRootId) : false)
  if (threadRootId && !addressed) return "skipped"
  const everyMessage = addressed
    ? false
    : await db
        .select({ mode: schema.channel.agentWakeMode })
        .from(schema.channel)
        .where(eq(schema.channel.id, args.channelId))
        .then((rows) => rows[0]?.mode === "every_message")
  const lane = addressed || everyMessage ? "wake" : "wait"
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
