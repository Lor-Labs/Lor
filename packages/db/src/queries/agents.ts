import { agentIdentityFor } from "@repo/utils/bestiary"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { APP_USER_ID, LOR_USER_ID, MAX_CHANNEL_AGENTS } from "../constants"
import { db } from "../index"
import { type Agent, agent, channelAgent } from "../schemas/agents"
import { channel } from "../schemas/channels"
import { type Loop, loop } from "../schemas/loops"
import { user } from "../schemas/users"

// Agents apart from channels (reference/agents-and-chats.md): the agents a
// channel holds. Every workspace member sees every agent, and what an agent
// knows is shared with the whole workspace (decision 22).

export { MAX_CHANNEL_AGENTS }

type ReadExecutor = Pick<typeof db, "select">
type WriteExecutor = Pick<typeof db, "insert">

// An agent's bot user never signs in or gets mail: no account row, and an
// address on a domain that can't exist.
export const agentUserEmail = (agentId: string) =>
  `${agentId}@agent.lor.invalid`

// The agent that wrote a message, for a query that joins the message's
// author: an agent's id is its bot user's id, so it is the author when the
// author is a bot that isn't Lor itself or the app. Null for people.
export const agentAuthorId = (author: typeof user = user) =>
  sql<
    string | null
  >`case when ${author.isBot} and ${author.id} not in (${LOR_USER_ID}::uuid, ${APP_USER_ID}::uuid) then ${author.id} end`

// The agent that answers in a channel, or null: a channel with no agent
// wakes nothing. With several, the first one added.
export async function loadChannelAgent(
  channelId: string,
  executor: ReadExecutor = db
): Promise<Agent | null> {
  const [row] = await executor
    .select({ agent })
    .from(channelAgent)
    .innerJoin(agent, eq(agent.id, channelAgent.agentId))
    .where(eq(channelAgent.channelId, channelId))
    .orderBy(asc(channelAgent.createdAt), asc(channelAgent.agentId))
    .limit(1)
  return row?.agent ?? null
}

// The agent whose own settings pay for work nobody's plan covers in a
// channel (`agent_harness_settings`). Null with no agent: the defaults.
export async function channelAgentId(
  channelId: string | null | undefined
): Promise<string | null> {
  if (!channelId) return null
  return (await loadChannelAgent(channelId))?.id ?? null
}

// That agent with its instructions for this channel only.
export async function loadChannelAgentPlacement(channelId: string) {
  const [row] = await db
    .select({
      agent,
      brief: channelAgent.brief,
      briefUpdatedAt: channelAgent.briefUpdatedAt,
    })
    .from(channelAgent)
    .innerJoin(agent, eq(agent.id, channelAgent.agentId))
    .where(eq(channelAgent.channelId, channelId))
    .orderBy(asc(channelAgent.createdAt), asc(channelAgent.agentId))
    .limit(1)
  return row ?? null
}

// Which agents are in which of these channels, in the order they were added.
export async function agentIdsByChannel(
  channelIds: string[],
  executor: ReadExecutor = db
): Promise<Map<string, string[]>> {
  const byChannel = new Map<string, string[]>()
  if (channelIds.length === 0) return byChannel
  const rows = await executor
    .select({
      channelId: channelAgent.channelId,
      agentId: channelAgent.agentId,
    })
    .from(channelAgent)
    .where(inArray(channelAgent.channelId, channelIds))
    .orderBy(asc(channelAgent.createdAt), asc(channelAgent.agentId))
  for (const row of rows) {
    byChannel.set(row.channelId, [
      ...(byChannel.get(row.channelId) ?? []),
      row.agentId,
    ])
  }
  return byChannel
}

// The agent a new Loop in a channel belongs to: the one that proposed it
// when it is in the channel, else the channel's first agent. Null: the
// channel has no agent, and nobody runs the Loop until one is picked.
export async function loopAgentFor(
  channelId: string,
  proposerId?: string | null,
  executor: ReadExecutor = db
): Promise<string | null> {
  const ids =
    (await agentIdsByChannel([channelId], executor)).get(channelId) ?? []
  return proposerId && ids.includes(proposerId) ? proposerId : (ids[0] ?? null)
}

export async function isAgentInChannel(
  agentId: string,
  channelId: string,
  executor: ReadExecutor = db
): Promise<boolean> {
  const rows = await executor
    .select({ agentId: channelAgent.agentId })
    .from(channelAgent)
    .where(
      and(
        eq(channelAgent.agentId, agentId),
        eq(channelAgent.channelId, channelId)
      )
    )
    .limit(1)
  return rows.length > 0
}

// An agent taken out of a chat stops running its Loops that report there:
// they pause, saying why, and stay the agent's until a person hands them to
// another agent or puts it back. `channelId` null: its Loops with no chat,
// which pause once it is in no chat at all (a turn needs one to start in).
// Returns the Loops paused, for the caller to emit.
export async function pauseLoopsAgentLeft(
  agentId: string,
  channelId: string | null
): Promise<Loop[]> {
  return db
    .update(loop)
    .set({ status: "paused", pausedReason: "agent_left", nextRunAt: null })
    .where(
      and(
        eq(loop.agentId, agentId),
        channelId ? eq(loop.channelId, channelId) : isNull(loop.channelId),
        eq(loop.status, "active")
      )
    )
    .returning()
}

// The chat a turn of the agent's starts in when its work has no chat of its
// own (a Loop with none): the first open chat it was put in. Null when it
// is in none.
export async function agentAnchorChannelId(
  agentId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: channelAgent.channelId })
    .from(channelAgent)
    .innerJoin(channel, eq(channel.id, channelAgent.channelId))
    .where(and(eq(channelAgent.agentId, agentId), isNull(channel.archivedAt)))
    .orderBy(asc(channelAgent.createdAt), asc(channelAgent.channelId))
    .limit(1)
  return row?.id ?? null
}

// The channels an agent is in.
export async function agentChannelIds(agentId: string): Promise<string[]> {
  const rows = await db
    .select({ id: channelAgent.channelId })
    .from(channelAgent)
    .where(eq(channelAgent.agentId, agentId))
    .orderBy(asc(channelAgent.createdAt))
  return rows.map((row) => row.id)
}

// The agent a new channel gets when nobody picked: the workspace's first.
// Null when it has none, and the channel starts with no agent.
export async function defaultAgentFor(
  workspaceId: string,
  executor: ReadExecutor = db
): Promise<Agent | null> {
  const [row] = await executor
    .select()
    .from(agent)
    .where(eq(agent.workspaceId, workspaceId))
    .orderBy(asc(agent.createdAt), asc(agent.id))
    .limit(1)
  return row ?? null
}

// A new agent, with the bot user it posts as. A name or creature nobody
// picked comes from its own id.
export async function createAgent(
  input: {
    workspaceId: string
    name?: string | null
    creature?: string | null
    role?: string | null
    brief?: string | null
    createdById?: string | null
  },
  executor: WriteExecutor = db
): Promise<Agent> {
  const id = crypto.randomUUID()
  const identity = agentIdentityFor(id, input)
  await executor.insert(user).values({
    id,
    name: identity.name,
    email: agentUserEmail(id),
    emailVerified: true,
    onboardingCompleted: true,
    isBot: true,
  })
  const [made] = await executor
    .insert(agent)
    .values({
      id,
      workspaceId: input.workspaceId,
      name: identity.name,
      creature: identity.creature,
      role: input.role?.trim() || null,
      brief: input.brief?.trim() || null,
      createdById: input.createdById ?? null,
    })
    .returning()
  if (!made) throw new Error("Agent insert returned no row")
  return made
}
