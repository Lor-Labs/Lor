import { db, eq, schema } from "@repo/db"
import { addInboxMessage } from "@repo/lor/channel-agent"
import type { RealtimeMessage } from "@repo/realtime-types"
import {
  AGENT_INBOX_BATCH_MS,
  AGENT_INBOX_FLUSH_JOB,
  type AgentInboxFlushJobData,
} from "@repo/realtime-types/queues"
import type { Queue } from "bullmq"
import { isLorMentioned, isReplyToLor } from "@/services/lor-routing"

// A message in the channel chat lands in the channel agent's inbox
// (reference/always-on-agents.md §3). A mention or a reply to the
// agent wakes it; anything else waits unread until its next turn, unless the
// channel is set to wake it on every message.
export async function addChatMessageToAgentInbox(args: {
  workspaceId: string
  channelId: string
  message: RealtimeMessage
  queue: Queue<AgentInboxFlushJobData>
}): Promise<"wake" | "wait" | "duplicate"> {
  const addressed =
    isLorMentioned(args.message.content) ||
    isReplyToLor(args.message.referencedMessage)
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
  return lane
}
