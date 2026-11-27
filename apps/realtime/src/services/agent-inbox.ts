import { asc, db, eq, schema } from "@repo/db"
import { addInboxMessage, agentsInThread } from "@repo/lor/channel-agent"
import type { RealtimeMessage } from "@repo/realtime-types"
import {
  AGENT_INBOX_BATCH_MS,
  AGENT_INBOX_CLASSIFY_JOB,
  AGENT_INBOX_FLUSH_JOB,
  type AgentInboxClassifyJobData,
  type AgentInboxFlushJobData,
} from "@repo/realtime-types/queues"
import type { Queue } from "bullmq"
import { logger } from "@/lib/logger"
import { agentsNamed } from "@/services/lor-routing"

// A message in a chat lands in the inbox of every agent in it
// (reference/always-on-agents.md §3; reference/agents-and-chats.md, decision
// 32). A mention of an agent or a reply to it wakes that agent; for the
// others, and when nobody is named, it waits unread until their next turn
// (decision 8: no "every message" setting). A chat message that names nobody
// is also judged at once by the worker (LOR-171): an agent it reads as meant
// for is woken now, the rest keep it for their check-in. In a human thread a message
// reaches the agents it names, or with none named every agent that is part
// of the thread (each may stay quiet); they answer in that thread, and the
// chat's other agents get nothing. What wakes an agent goes to its request's
// conversation, so two people asking at once don't share a queue; what waits
// goes to the agent's own conversation, for its check-in (decisions 26 and
// 28). A chat with no agent is plain human chat: nothing is queued.
// Returns the agents the message named, for the typing signal.
export async function addChatMessageToAgentInbox(args: {
  workspaceId: string
  channelId: string
  message: RealtimeMessage
  queue: Queue<AgentInboxFlushJobData | AgentInboxClassifyJobData>
}): Promise<{ id: string; name: string }[]> {
  const placed = await db
    .select({ id: schema.agent.id, name: schema.agent.name })
    .from(schema.channelAgent)
    .innerJoin(schema.agent, eq(schema.agent.id, schema.channelAgent.agentId))
    .where(eq(schema.channelAgent.channelId, args.channelId))
    .orderBy(
      asc(schema.channelAgent.createdAt),
      asc(schema.channelAgent.agentId)
    )
  if (placed.length === 0) return []
  const agentIds = placed.map((agent) => agent.id)
  const named = agentsNamed({
    content: args.message.content,
    referencedMessage: args.message.referencedMessage,
    agentIds,
  })
  const threadRootId = args.message.threadRootId
  const inThread =
    threadRootId && named.size === 0
      ? await agentsInThread(threadRootId, agentIds)
      : new Set<string>()
  const addressed: { id: string; name: string }[] = []
  const wakeConversations: string[] = []
  for (const agent of placed) {
    const wakes = named.has(agent.id) || inThread.has(agent.id)
    // A thread reply is not chat an agent outside the thread reads later.
    if (threadRootId && !wakes) continue
    const lane = wakes ? "wake" : "wait"
    const conversationId = await addInboxMessage({
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      agentId: agent.id,
      messageId: args.message.id,
      lane,
    })
    if (!conversationId) continue
    if (lane === "wake") wakeConversations.push(conversationId)
    if (named.has(agent.id)) addressed.push(agent)
  }
  // Every inbox row is written before any wake is queued, so a queue failure
  // can't keep later agents from getting the message; the stranded-inbox
  // sweep flushes a wake that failed to queue.
  for (const conversationId of wakeConversations) {
    // A short delay, so quick messages in a row become one turn.
    await args.queue
      .add(
        AGENT_INBOX_FLUSH_JOB,
        { conversationId },
        { delay: AGENT_INBOX_BATCH_MS }
      )
      .catch((err: unknown) =>
        logger.warn({ err, conversationId }, "Agent inbox wake flush failed")
      )
  }
  if (named.size === 0 && !threadRootId) {
    // Best effort: without it the message waits for the check-in.
    await args.queue
      .add(AGENT_INBOX_CLASSIFY_JOB, {
        channelId: args.channelId,
        messageId: args.message.id,
      })
      .catch(() => {})
  }
  return addressed
}
