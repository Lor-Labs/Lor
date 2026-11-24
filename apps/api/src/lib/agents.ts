import { and, db, eq, inArray, schema } from "@repo/db"
import { defaultAgentFor, MAX_CHANNEL_AGENTS } from "@repo/db/queries/agents"
import { resetAgentConversation } from "@repo/lor/channel-agent"
import { ensureCheckInLoop } from "@repo/lor/check-in"
import { syncAgentRole } from "@repo/lor/discord"
import { workspaceRoom } from "@repo/realtime-types"
import { getEmitter } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

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
// for. A workspace with no agent leaves them as plain human chat.
export async function placeDefaultAgent(
  tx: Tx,
  input: { workspaceId: string; channelIds: string[]; addedById: string | null }
): Promise<string | null> {
  if (input.channelIds.length === 0) return null
  const agent = await defaultAgentFor(input.workspaceId, tx)
  if (!agent) return null
  await tx.insert(schema.channelAgent).values(
    input.channelIds.map((channelId) => ({
      channelId,
      agentId: agent.id,
      addedById: input.addedById,
    }))
  )
  return agent.id
}

export type SetChannelAgentsResult =
  | { ok: true; agentIds: string[]; changed: boolean }
  | { ok: false; reason: "not_found" | "too_many" }

// Sets which agents are in a text channel: any of the workspace's, in any
// channel. What one learns in a private channel stays there by scope, so
// nothing has to keep it out. An empty list leaves plain human chat.
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
    }
  }
  return input.tx ? apply(input.tx) : db.transaction(apply)
}

// After a channel's agents changed: a different agent starts a fresh
// conversation there, the channel gets its check-in with its first agent,
// and a linked Discord channel's @mention role follows the new name.
export async function afterChannelAgentsChanged(input: {
  workspaceId: string
  channelId: string
  hasAgent: boolean
}) {
  const { channelId } = input
  await resetAgentConversation(channelId).catch((err: unknown) =>
    logger.warn({ err, channelId }, "Agent conversation reset failed")
  )
  if (input.hasAgent) {
    await ensureCheckInLoop(channelId).catch((err: unknown) =>
      logger.warn({ err, channelId }, "Check-in Loop failed")
    )
    void syncAgentRole(channelId).catch((err: unknown) =>
      logger.warn({ err, channelId }, "Discord agent role rename failed")
    )
  }
  emitAgentsUpdated(input.workspaceId)
}
