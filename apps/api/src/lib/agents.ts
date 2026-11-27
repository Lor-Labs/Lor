import { and, db, eq, inArray, schema, sql } from "@repo/db"
import { defaultAgentFor, MAX_CHANNEL_AGENTS } from "@repo/db/queries/agents"
import { clearAgentChannelInbox } from "@repo/lor/channel-agent"
import { deleteAgentPlaceResources, discordLinkFor } from "@repo/lor/discord"
import { workspaceRoom } from "@repo/realtime-types"
import { getEmitter } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"
import { pauseLoopsOfRemovedAgent } from "@/lib/loops"

// Agents apart from channels (reference/agents-and-chats.md).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Tells the workspace its agents, or which channel holds which, changed:
// clients refetch the agent list and their channels.
export function emitAgentsUpdated(workspaceId: string) {
  void getEmitter()
    .then((io) =>
      io.to(workspaceRoom(workspaceId)).emit("agents:updated", { workspaceId })
    )
    .catch((err: unknown) =>
      logger.warn({ err, workspaceId }, "agents:updated emit failed")
    )
}

// Puts the workspace's first agent in new text channels nobody picked one
// for. A workspace with no agent leaves them as plain human chat. So does a
// private channel (its own, or its category's): what an agent knows is
// shared with the whole workspace, so one goes into a private channel only
// when someone puts it there (reference/agents-and-chats.md, decision 22).
export async function placeDefaultAgent(
  tx: Tx,
  input: { workspaceId: string; channelIds: string[]; addedById: string | null }
): Promise<string | null> {
  if (input.channelIds.length === 0) return null
  const rows = await tx
    .select({
      id: schema.channel.id,
      audience: schema.channel.audience,
      parentId: schema.channel.parentId,
      // Qualified by hand: drizzle drops the table name in a one-table
      // select, which would bind parent_id to p.
      parentAudience: sql<
        "workspace" | "members" | null
      >`(select p.audience from channel p where p.id = "channel"."parent_id")`,
    })
    .from(schema.channel)
    .where(inArray(schema.channel.id, input.channelIds))
  const open = rows
    .filter(
      (row) =>
        (row.parentId ? row.parentAudience : row.audience) === "workspace"
    )
    .map((row) => row.id)
  if (open.length === 0) return null
  const agent = await defaultAgentFor(input.workspaceId, tx)
  if (!agent) return null
  await tx.insert(schema.channelAgent).values(
    open.map((channelId) => ({
      channelId,
      agentId: agent.id,
      addedById: input.addedById,
    }))
  )
  return agent.id
}

export type SetChannelAgentsResult =
  // `removed`: the agents taken out of the channel.
  | { ok: true; agentIds: string[]; changed: boolean; removed: string[] }
  | { ok: false; reason: "not_found" | "too_many" }

// Sets which agents are in a text channel: any of the workspace's, in any
// channel, private ones too. An empty list leaves plain human chat.
export async function setChannelAgents(input: {
  workspaceId: string
  channelId: string
  agentIds: string[]
  userId: string
  tx?: Tx
}): Promise<SetChannelAgentsResult> {
  const wanted = [...new Set(input.agentIds)]
  if (wanted.length > MAX_CHANNEL_AGENTS)
    return { ok: false, reason: "too_many" }
  const apply = async (tx: Tx): Promise<SetChannelAgentsResult> => {
    if (wanted.length > 0) {
      const found = await tx
        .select({ id: schema.agent.id })
        .from(schema.agent)
        .where(
          and(
            eq(schema.agent.workspaceId, input.workspaceId),
            inArray(schema.agent.id, wanted)
          )
        )
      if (found.length !== wanted.length)
        return { ok: false, reason: "not_found" }
    }
    const rows = await tx
      .select({
        agentId: schema.channelAgent.agentId,
        brief: schema.channelAgent.brief,
      })
      .from(schema.channelAgent)
      .where(eq(schema.channelAgent.channelId, input.channelId))
      .for("update")
    const current = rows.map((row) => row.agentId)
    const removed = current.filter((id) => !wanted.includes(id))
    const added = wanted.filter((id) => !current.includes(id))
    // One agent replacing another keeps the channel's instructions: they
    // were written for the channel, whoever is in it.
    const inherited =
      removed.length === 1 && added.length === 1
        ? (rows.find((row) => row.agentId === removed[0])?.brief ?? null)
        : null
    if (removed.length > 0) {
      await tx
        .delete(schema.channelAgent)
        .where(
          and(
            eq(schema.channelAgent.channelId, input.channelId),
            inArray(schema.channelAgent.agentId, removed)
          )
        )
    }
    if (added.length > 0) {
      await tx.insert(schema.channelAgent).values(
        added.map((agentId) => ({
          channelId: input.channelId,
          agentId,
          addedById: input.userId,
          ...(inherited
            ? { brief: inherited, briefUpdatedAt: new Date() }
            : {}),
        }))
      )
    }
    return {
      ok: true,
      agentIds: wanted,
      changed: removed.length > 0 || added.length > 0,
      removed,
    }
  }
  return input.tx ? apply(input.tx) : db.transaction(apply)
}

// After a channel's agents changed: an agent taken out reads nothing more
// from the channel (its conversations stay, and a new agent's are its own),
// and in a place it loses its Discord webhook there.
export async function afterChannelAgentsChanged(input: {
  workspaceId: string
  channelId: string
  hasAgent: boolean
  removed: string[]
}) {
  const { channelId } = input
  await Promise.all(
    input.removed.flatMap((agentId) => [
      clearAgentChannelInbox(agentId, channelId).catch((err: unknown) =>
        logger.warn({ err, channelId }, "Agent inbox clear failed")
      ),
      // Its Loops that report here stay its own and pause.
      pauseLoopsOfRemovedAgent(agentId, channelId).catch((err: unknown) =>
        logger.warn({ err, channelId }, "Agent loops pause failed")
      ),
    ])
  )
  const link =
    input.removed.length > 0
      ? await discordLinkFor(channelId).catch(() => null)
      : null
  if (link) {
    for (const agentId of input.removed) {
      await deleteAgentPlaceResources(link, agentId).catch((err: unknown) =>
        logger.warn({ err, channelId }, "Discord agent cleanup failed")
      )
    }
  }
  emitAgentsUpdated(input.workspaceId)
}
