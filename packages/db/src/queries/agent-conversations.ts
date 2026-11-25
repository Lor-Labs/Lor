import { and, eq } from "drizzle-orm"
import { db } from "../index"
import {
  type AgentConversation,
  agentConversation,
  agentConversationPost,
} from "../schemas/agent-conversations"

// An agent's conversations (reference/agents-and-chats.md, decision 28):
// finding or making the one a piece of work belongs to.

type Executor = Pick<typeof db, "select" | "insert">

export async function loadConversation(
  conversationId: string,
  executor: Pick<typeof db, "select"> = db
): Promise<AgentConversation | null> {
  const [row] = await executor
    .select()
    .from(agentConversation)
    .where(eq(agentConversation.id, conversationId))
  return row ?? null
}

// The agent's own conversation, made on first use: where its check-in,
// loops, events and its own wake-ups run.
export async function ownConversation(
  input: { workspaceId: string; agentId: string },
  executor: Executor = db
): Promise<AgentConversation> {
  const own = and(
    eq(agentConversation.agentId, input.agentId),
    eq(agentConversation.kind, "own")
  )
  const [existing] = await executor.select().from(agentConversation).where(own)
  if (existing) return existing
  await executor
    .insert(agentConversation)
    .values({ ...input, kind: "own" })
    .onConflictDoNothing()
  const [made] = await executor.select().from(agentConversation).where(own)
  if (!made) throw new Error("Agent conversation insert returned no row")
  return made
}

// The conversation of the request that started from this message, made on
// first use.
async function requestConversation(
  input: {
    workspaceId: string
    agentId: string
    channelId: string
    rootMessageId: string
    startedById: string | null
  },
  executor: Executor
): Promise<AgentConversation> {
  const mine = and(
    eq(agentConversation.agentId, input.agentId),
    eq(agentConversation.rootMessageId, input.rootMessageId)
  )
  const [existing] = await executor.select().from(agentConversation).where(mine)
  if (existing) return existing
  await executor
    .insert(agentConversation)
    .values({ ...input, kind: "request" })
    .onConflictDoNothing()
  const [made] = await executor.select().from(agentConversation).where(mine)
  if (!made) throw new Error("Agent conversation insert returned no row")
  return made
}

// The request one of the agent's own chat posts came from.
async function postConversation(
  agentId: string,
  messageId: string,
  executor: Executor
): Promise<AgentConversation | null> {
  const [row] = await executor
    .select({ conversation: agentConversation })
    .from(agentConversationPost)
    .innerJoin(
      agentConversation,
      eq(agentConversation.id, agentConversationPost.conversationId)
    )
    .where(
      and(
        eq(agentConversationPost.messageId, messageId),
        eq(agentConversation.agentId, agentId),
        eq(agentConversation.kind, "request")
      )
    )
  return row?.conversation ?? null
}

// Which conversation a message addressed to the agent belongs to. In a
// thread, the thread's request. A reply to, or a thread under, something the
// agent posted for a request continues that request. Anything else starts a
// new request from this message, so two people asking at once never share a
// queue.
export async function conversationForMessage(
  input: {
    workspaceId: string
    agentId: string
    channelId: string
    message: {
      id: string
      threadRootId: string | null
      referencedMessageId: string | null
      authorId: string | null
    }
  },
  executor: Executor = db
): Promise<AgentConversation> {
  const { message, ...place } = input
  const start = (rootMessageId: string) =>
    requestConversation(
      { ...place, rootMessageId, startedById: message.authorId },
      executor
    )
  if (message.threadRootId) {
    const [existing] = await executor
      .select()
      .from(agentConversation)
      .where(
        and(
          eq(agentConversation.agentId, input.agentId),
          eq(agentConversation.rootMessageId, message.threadRootId)
        )
      )
    return (
      existing ??
      (await postConversation(input.agentId, message.threadRootId, executor)) ??
      start(message.threadRootId)
    )
  }
  const continued = message.referencedMessageId
    ? await postConversation(
        input.agentId,
        message.referencedMessageId,
        executor
      )
    : null
  return continued ?? start(message.id)
}

// Remembers which request a post in the channel's chat came from.
export async function recordConversationPost(
  messageId: string,
  conversationId: string
): Promise<void> {
  await db
    .insert(agentConversationPost)
    .values({ messageId, conversationId })
    .onConflictDoNothing()
}
