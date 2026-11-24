import { agentIdentityFor } from "@repo/utils/bestiary"
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm"
import { db } from "../index"
import { type Agent, agent } from "../schemas/agents"
import { channel, channelMember } from "../schemas/channels"
import { hasChannelMemberRow, resolveAccessContainer } from "./channel-access"

// Agents apart from channels (reference/agents-and-chats.md): who can see an
// agent, which channels it may be added to, and the agent a channel holds.

type ReadExecutor = Pick<typeof db, "select">
type WriteExecutor = Pick<typeof db, "insert">

// The agent in a channel, or null: a channel with no agent wakes nothing.
export async function loadChannelAgent(
  channelId: string,
  executor: ReadExecutor = db
): Promise<Agent | null> {
  const [row] = await executor
    .select({ agent })
    .from(channel)
    .innerJoin(agent, eq(agent.id, channel.agentId))
    .where(eq(channel.id, channelId))
    .limit(1)
  return row?.agent ?? null
}

// An agent is open to the whole workspace, or to the members of one access
// container. Workspace membership is the caller's check.
export async function userCanSeeAgent(
  userId: string,
  target: Pick<Agent, "accessContainerId">
): Promise<boolean> {
  if (!target.accessContainerId) return true
  return hasChannelMemberRow(target.accessContainerId, userId)
}

export async function listVisibleAgents(
  userId: string,
  workspaceId: string
): Promise<Agent[]> {
  const containers = db
    .select({ id: channelMember.channelId })
    .from(channelMember)
    .where(eq(channelMember.userId, userId))
  return db
    .select()
    .from(agent)
    .where(
      and(
        eq(agent.workspaceId, workspaceId),
        or(
          isNull(agent.accessContainerId),
          inArray(agent.accessContainerId, containers)
        )
      )
    )
    .orderBy(asc(agent.createdAt), asc(agent.id))
}

// The audience an agent must have to be in a channel: null for a channel the
// whole workspace sees, else the members-only container's id. An agent
// carries what it hears, so it is only added where its audience is the same.
export async function channelAgentAudience(
  row: {
    id: string
    audience: "workspace" | "members"
    parentId: string | null
  },
  executor: ReadExecutor = db
): Promise<string | null> {
  const container = await resolveAccessContainer(row, executor)
  return container.audience === "members" ? container.id : null
}

export function agentFitsAudience(
  target: Pick<Agent, "accessContainerId">,
  audience: string | null
): boolean {
  return (target.accessContainerId ?? null) === audience
}

// The agent a new channel gets when nobody picked: the oldest one with the
// channel's audience. Null when there is none, and the channel starts with
// no agent.
export async function defaultAgentFor(
  workspaceId: string,
  audience: string | null,
  executor: ReadExecutor = db
): Promise<Agent | null> {
  const [row] = await executor
    .select()
    .from(agent)
    .where(
      and(
        eq(agent.workspaceId, workspaceId),
        audience
          ? eq(agent.accessContainerId, audience)
          : isNull(agent.accessContainerId)
      )
    )
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
    accessContainerId?: string | null
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
      accessContainerId: input.accessContainerId ?? null,
      createdById: input.createdById ?? null,
    })
    .returning()
  if (!made) throw new Error("Agent insert returned no row")
  return made
}

// The channels an agent is in.
export async function agentChannelIds(agentId: string): Promise<string[]> {
  const rows = await db
    .select({ id: channel.id })
    .from(channel)
    .where(eq(channel.agentId, agentId))
  return rows.map((row) => row.id)
}
