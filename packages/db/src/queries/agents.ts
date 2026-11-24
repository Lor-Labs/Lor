import { agentIdentityFor } from "@repo/utils/bestiary"
import { asc, eq, inArray } from "drizzle-orm"
import { MAX_CHANNEL_AGENTS } from "../constants"
import { db } from "../index"
import { type Agent, agent, channelAgent } from "../schemas/agents"

// Agents apart from channels (reference/agents-and-chats.md): the agents a
// channel holds. Every workspace member sees every agent, and what an agent
// knows is shared with the whole workspace (decision 22).

export { MAX_CHANNEL_AGENTS }

type ReadExecutor = Pick<typeof db, "select">
type WriteExecutor = Pick<typeof db, "insert">

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

// A new agent. A name or creature nobody picked comes from its own id.
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
