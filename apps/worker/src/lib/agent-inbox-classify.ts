import { recordUsage } from "@repo/billing"
import {
  APP_USER_ID,
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  isNull,
  LOR_USER_ID,
  lt,
  schema,
  sql,
} from "@repo/db"
import { wakeForWaitingMessage } from "@repo/lor/channel-agent"
import {
  decideInboxAddress,
  type InboxAddressInput,
} from "@repo/lor/inbox-address"
import {
  AGENT_INBOX_BATCH_MS,
  AGENT_INBOX_FLUSH_JOB,
  type AgentInboxClassifyJobData,
} from "@repo/realtime-types/queues"
import type { AgentDeps } from "@/lib/agent-inbox"
import { logger } from "@/lib/logger"

const RECENT_MESSAGES = 12
const WORKING_MAX = 3

// A chat message that named no agent waits in every agent's inbox. This
// asks Jev which of them it is meant for and wakes those now, each in a
// request of its own; the rest keep it for their check-in (LOR-171,
// reference/agents-and-chats.md). The woken agent is told the message did
// not name it and may stay quiet.
export async function classifyInboxMessage(
  deps: Pick<AgentDeps, "queue">,
  data: AgentInboxClassifyJobData
): Promise<void> {
  const [message] = await db
    .select({
      id: schema.message.id,
      content: schema.message.content,
      createdAt: schema.message.createdAt,
      threadRootId: schema.message.threadRootId,
      authorId: schema.message.authorId,
      authorName: sql<string>`coalesce(${schema.message.overrideName}, ${schema.user.name})`,
      authorIsBot: schema.user.isBot,
      chatName: schema.channel.name,
      workspaceId: schema.channel.workspaceId,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.user.id, schema.message.authorId))
    .innerJoin(schema.channel, eq(schema.channel.id, schema.message.channelId))
    .where(
      and(
        eq(schema.message.id, data.messageId),
        eq(schema.message.channelId, data.channelId)
      )
    )
  // A thread reply already reaches the agents in its thread and no others.
  if (!message?.workspaceId || message.threadRootId) return
  const text = message.content?.trim()
  if (!text) return
  const workspaceId = message.workspaceId

  const context = await loadAddressContext({
    channelId: data.channelId,
    before: message.createdAt,
    exceptAgentId: message.authorId,
  })
  if (context.agents.length === 0) return

  const decision = await decideInboxAddress({
    chatName: message.chatName ?? "chat",
    recent: context.recent,
    message: {
      author: message.authorName,
      isAgent: message.authorIsBot,
      text,
    },
    agents: context.agents,
  })
  if (decision.responded) {
    void recordUsage(
      {
        workspaceId,
        tool: "lor.inbox.classify",
        model: decision.model,
        inputTokens: decision.inputTokens,
        outputTokens: decision.outputTokens,
        costUsd: decision.costUsd,
        wallMs: decision.wallMs,
      },
      { messageId: message.id, channelId: data.channelId }
    )
  }
  const woken: string[] = []
  for (const agentId of decision.agentIds) {
    const conversationId = await wakeForWaitingMessage({
      workspaceId,
      channelId: data.channelId,
      agentId,
      messageId: message.id,
    })
    if (!conversationId) continue
    woken.push(agentId)
    await deps.queue
      .add(
        AGENT_INBOX_FLUSH_JOB,
        { conversationId },
        { delay: AGENT_INBOX_BATCH_MS }
      )
      // The stranded-inbox sweep flushes it; the other agents still wake.
      .catch((err) =>
        logger.warn({ err, conversationId }, "Agent inbox wake flush failed")
      )
  }
  logger.info(
    {
      messageId: message.id,
      scores: decision.scores,
      woken,
      wallMs: decision.wallMs,
      error: decision.error,
    },
    "Agent inbox message classified"
  )
}

// What Jev is shown to judge who a message is for: the chat's agents (but
// its writer) with their role, brief and open sessions, and what was said
// in the chat before it. Shared with the agents' room (agent-messages.ts).
export async function loadAddressContext(data: {
  channelId: string
  before: Date
  exceptAgentId: string
}): Promise<Pick<InboxAddressInput, "agents" | "recent">> {
  const agents = (
    await db
      .select({
        id: schema.agent.id,
        name: schema.agent.name,
        role: schema.agent.role,
        brief: schema.agent.brief,
        chatBrief: schema.channelAgent.brief,
      })
      .from(schema.channelAgent)
      .innerJoin(schema.agent, eq(schema.agent.id, schema.channelAgent.agentId))
      .where(eq(schema.channelAgent.channelId, data.channelId))
      .orderBy(
        asc(schema.channelAgent.createdAt),
        asc(schema.channelAgent.agentId)
      )
  ).filter((agent) => agent.id !== data.exceptAgentId)
  if (agents.length === 0) return { agents: [], recent: [] }
  const agentIds = agents.map((agent) => agent.id)

  const [recent, sessions] = await Promise.all([
    db
      .select({
        content: schema.message.content,
        authorId: schema.message.authorId,
        authorName: sql<string>`coalesce(${schema.agent.name}, ${schema.message.overrideName}, ${schema.user.name})`,
        agentId: schema.agent.id,
      })
      .from(schema.message)
      .innerJoin(schema.user, eq(schema.user.id, schema.message.authorId))
      .leftJoin(schema.agent, eq(schema.agent.id, schema.message.authorId))
      .where(
        and(
          eq(schema.message.channelId, data.channelId),
          isNull(schema.message.threadRootId),
          inArray(schema.message.type, ["default", "reply", "agent_post"]),
          lt(schema.message.createdAt, data.before),
          sql`btrim(coalesce(${schema.message.content}, '')) <> ''`
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(RECENT_MESSAGES),
    // What each agent has going in this chat: the code sessions it started.
    db
      .select({
        agentId: schema.agentConversation.agentId,
        title: schema.agentSession.title,
      })
      .from(schema.agentSession)
      .innerJoin(
        schema.agentConversation,
        eq(schema.agentConversation.id, schema.agentSession.conversationId)
      )
      .where(
        and(
          eq(schema.agentSession.channelId, data.channelId),
          eq(schema.agentSession.origin, "agent"),
          isNull(schema.agentSession.archivedAt),
          inArray(schema.agentConversation.agentId, agentIds)
        )
      )
      .orderBy(desc(schema.agentSession.createdAt))
      .limit(WORKING_MAX * agentIds.length),
  ])
  const isAgent = (line: { authorId: string; agentId: string | null }) =>
    line.agentId !== null ||
    line.authorId === LOR_USER_ID ||
    line.authorId === APP_USER_ID

  return {
    recent: recent.reverse().map((line) => ({
      author: line.authorName,
      isAgent: isAgent(line),
      text: line.content ?? "",
    })),
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      brief: [agent.brief, agent.chatBrief].filter(Boolean).join(" ") || null,
      working: sessions
        .filter((session) => session.agentId === agent.id)
        .slice(0, WORKING_MAX)
        .map((session) => session.title),
    })),
  }
}
