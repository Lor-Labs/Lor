import { agentIdentityFor } from "@repo/utils/bestiary"
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm"
import { db } from "../index"
import { agentFact } from "../schemas/agent-facts"
import { type Agent, agent, channelAgent } from "../schemas/agents"
import { channel, channelMember } from "../schemas/channels"
import { resolveAccessContainer } from "./channel-access"

// Agents apart from channels (reference/agents-and-chats.md): the agents a
// channel holds, and where what an agent learns may be seen. Every workspace
// member sees every agent. What it learns in a private channel stays there
// by scope, like brain pages, so any agent can be added to any channel.

type ReadExecutor = Pick<typeof db, "select">
type WriteExecutor = Pick<typeof db, "insert">

// The data allows several agents in a channel; the app holds it to one until
// each has its own conversation there (step 2 of the plan).
export const MAX_CHANNEL_AGENTS = 1

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

// Where something an agent learns in this channel may be seen: null for a
// channel the whole workspace sees, else its members-only container (a
// private channel, or the private category it is in). The scope of an agent
// fact (`agent_fact.scope_channel_id`), by the same rule as brain pages.
export async function agentScopeFor(
  channelId: string,
  executor: ReadExecutor = db
): Promise<string | null> {
  const [row] = await executor
    .select({
      id: channel.id,
      audience: channel.audience,
      parentId: channel.parentId,
    })
    .from(channel)
    .where(eq(channel.id, channelId))
  if (!row) return null
  const container = await resolveAccessContainer(row, executor)
  return container.audience === "members" ? container.id : null
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

// The facts visible from these scopes: what the whole workspace can see,
// plus what was learned in each private container given. One scope for an
// agent's turn in a channel; a person's member scopes for the settings list.
export function factsVisibleIn(scopes: (string | null)[]) {
  const containers = scopes.filter((scope): scope is string => scope !== null)
  return containers.length > 0
    ? or(
        isNull(agentFact.scopeChannelId),
        inArray(agentFact.scopeChannelId, containers)
      )
    : isNull(agentFact.scopeChannelId)
}

// The members-only containers of this workspace a person is in: the scopes
// whose facts they may list.
export async function memberScopes(
  userId: string,
  workspaceId: string
): Promise<string[]> {
  const rows = await db
    .select({ id: channel.id })
    .from(channelMember)
    .innerJoin(channel, eq(channel.id, channelMember.channelId))
    .where(
      and(
        eq(channelMember.userId, userId),
        eq(channel.workspaceId, workspaceId),
        eq(channel.audience, "members")
      )
    )
  return rows.map((row) => row.id)
}
