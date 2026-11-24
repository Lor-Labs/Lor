import { db, eq, schema } from "@repo/db"
import { agentFitsAudience, defaultAgentFor } from "@repo/db/queries/agents"
import { workspaceRoom } from "@repo/realtime-types"
import { getEmitter } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

// Agents apart from channels (reference/agents-and-chats.md).

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

// The agent a channel is given. `requested` undefined means nobody picked:
// the workspace's first agent with the channel's audience, or none. Null
// means no agent. An id must be this workspace's and share the channel's
// audience (an agent carries what it hears, so it never spans audiences).
export async function resolveChannelAgentId(input: {
  workspaceId: string
  requested: string | null | undefined
  // The audience an agent must have here: null for the whole workspace, else
  // the members-only container's id.
  audience: string | null
}): Promise<{ ok: true; agentId: string | null } | { ok: false }> {
  if (input.requested === null) return { ok: true, agentId: null }
  if (input.requested === undefined) {
    const found = await defaultAgentFor(input.workspaceId, input.audience)
    return { ok: true, agentId: found?.id ?? null }
  }
  const [found] = await db
    .select({
      id: schema.agent.id,
      workspaceId: schema.agent.workspaceId,
      accessContainerId: schema.agent.accessContainerId,
    })
    .from(schema.agent)
    .where(eq(schema.agent.id, input.requested))
  if (
    !found ||
    found.workspaceId !== input.workspaceId ||
    !agentFitsAudience(found, input.audience)
  ) {
    return { ok: false }
  }
  return { ok: true, agentId: found.id }
}
