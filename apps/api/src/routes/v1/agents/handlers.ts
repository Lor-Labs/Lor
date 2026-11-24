import { db, schema } from "@repo/db"
import {
  agentChannelIds,
  createAgent as insertAgent,
  listVisibleAgents,
  userCanSeeAgent,
} from "@repo/db/queries/agents"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import type { Agent } from "@repo/db/schema"
import { resetAgentConversation } from "@repo/lor/channel-agent"
import { agentProfileLock } from "@repo/lor/channel-profile"
import { syncAgentRole } from "@repo/lor/discord"
import { isLorCreditModel } from "@repo/lor/model-catalog"
import { normalizeAgentName } from "@repo/utils/bestiary"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { emitAgentsUpdated } from "@/lib/agents"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import {
  assertWorkspaceAuthority,
  hasWorkspaceAuthority,
} from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  CreateAgentRoute,
  DeleteAgentFactRoute,
  DeleteAgentRoute,
  ListAgentFactsRoute,
  ListAgentsRoute,
  UpdateAgentFactRoute,
  UpdateAgentRoute,
} from "@/routes/v1/agents/routes"

// Agents apart from channels (reference/agents-and-chats.md). Managing an
// agent (its brief, model, existence) takes channel:update, as the channel's
// agent settings did; the person who made an agent may still name it.

function serializeAgent(agent: Agent, channelIds: string[]) {
  return {
    id: agent.id,
    name: agent.name,
    creature: agent.creature,
    role: agent.role,
    brief: agent.brief,
    model: agent.model,
    accessContainerId: agent.accessContainerId,
    createdById: agent.createdById,
    createdAt: agent.createdAt.toISOString(),
    channelIds,
  }
}

const notFound = { success: false as const, message: "Agent not found" }

// An agent of this workspace the caller can see. A private agent's existence
// never leaks: missing and hidden read the same.
async function visibleAgent(
  workspaceId: string,
  agentId: string,
  userId: string
): Promise<Agent | null> {
  const [found] = await db
    .select()
    .from(schema.agent)
    .where(
      and(
        eq(schema.agent.id, agentId),
        eq(schema.agent.workspaceId, workspaceId)
      )
    )
  if (!found || !(await userCanSeeAgent(userId, found))) return null
  return found
}

// The channels an agent is in that this person can see.
async function visibleChannelIds(
  agentId: string,
  userId: string,
  workspaceId: string
) {
  const [ids, accessible] = await Promise.all([
    agentChannelIds(agentId),
    listAccessibleChannelIds(userId, workspaceId),
  ])
  return ids.filter((id) => accessible.has(id))
}

export const listAgents: AppRouteHandler<ListAgentsRoute> = async (c) => {
  const workspace = c.var.workspace
  const userId = c.var.user.id
  const [agents, accessible] = await Promise.all([
    listVisibleAgents(userId, workspace.id),
    listAccessibleChannelIds(userId, workspace.id),
  ])
  const placed =
    agents.length > 0
      ? await db
          .select({ id: schema.channel.id, agentId: schema.channel.agentId })
          .from(schema.channel)
          .where(
            inArray(
              schema.channel.agentId,
              agents.map((agent) => agent.id)
            )
          )
          .orderBy(asc(schema.channel.position))
      : []
  return c.json(
    {
      agents: agents.map((agent) =>
        serializeAgent(
          agent,
          placed
            .filter((row) => row.agentId === agent.id && accessible.has(row.id))
            .map((row) => row.id)
        )
      ),
    },
    HttpStatusCodes.OK
  )
}

export const createAgent: AppRouteHandler<CreateAgentRoute> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const body = c.req.valid("json")
  assertWorkspaceAuthority(c.var.authority, { channel: ["update"] })

  if (body.model && !isLorCreditModel(body.model)) {
    return c.json(
      { success: false, message: "Model not available" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  // A private agent belongs to one members-only container (a private channel
  // or a private category) the caller is in.
  if (body.accessContainerId) {
    const [container] = await db
      .select({
        audience: schema.channel.audience,
        parentId: schema.channel.parentId,
      })
      .from(schema.channel)
      .where(
        and(
          eq(schema.channel.id, body.accessContainerId),
          eq(schema.channel.workspaceId, workspace.id)
        )
      )
    if (
      !container ||
      container.audience !== "members" ||
      container.parentId ||
      !(await userCanAccessChannel(body.accessContainerId, currentUser.id))
    ) {
      return c.json(
        { success: false, message: "Channel not found" },
        HttpStatusCodes.NOT_FOUND
      )
    }
  }
  const name = body.name ? normalizeAgentName(body.name) : null
  const made = await insertAgent({
    workspaceId: workspace.id,
    name,
    creature: body.creature,
    role: body.role,
    brief: body.brief,
    accessContainerId: body.accessContainerId,
    createdById: currentUser.id,
  })
  const agent = body.model
    ? ((
        await db
          .update(schema.agent)
          .set({ model: body.model.trim() })
          .where(eq(schema.agent.id, made.id))
          .returning()
      )[0] ?? made)
    : made
  emitAgentsUpdated(workspace.id)
  return c.json(serializeAgent(agent, []), HttpStatusCodes.OK)
}

export const updateAgent: AppRouteHandler<UpdateAgentRoute> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { agentId } = c.req.valid("param")
  const body = c.req.valid("json")

  const agent = await visibleAgent(workspace.id, agentId, currentUser.id)
  if (!agent) return c.json(notFound, HttpStatusCodes.NOT_FOUND)

  // The brief and the model always need channel:update. Without it, the
  // person who made the agent may still change how it appears.
  const canManage = hasWorkspaceAuthority(c.var.authority, {
    channel: ["update"],
  })
  const appearanceOnly = body.brief === undefined && body.model === undefined
  if (!canManage && !(appearanceOnly && agent.createdById === currentUser.id)) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  if (body.model && !isLorCreditModel(body.model)) {
    return c.json(
      { success: false, message: "Model not available" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const name =
    body.name === undefined ? undefined : normalizeAgentName(body.name)
  if (name === null) {
    return c.json(
      { success: false, message: "Name is not usable" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const identityChanged =
    (name !== undefined && name !== agent.name) ||
    (body.creature !== undefined && body.creature !== agent.creature)
  const now = new Date()
  const [updated] = await db
    .update(schema.agent)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(body.creature !== undefined ? { creature: body.creature } : {}),
      // The agent learns its new name or brief from a change note, in each
      // of its channels.
      ...(identityChanged ? { identityUpdatedAt: now } : {}),
      ...(body.role !== undefined ? { role: body.role?.trim() || null } : {}),
      ...(body.brief !== undefined
        ? { brief: body.brief?.trim() || null, briefUpdatedAt: now }
        : {}),
      // An empty model means the default, like null.
      ...(body.model !== undefined
        ? { model: body.model?.trim() || null }
        : {}),
    })
    .where(eq(schema.agent.id, agent.id))
    .returning()
  if (!updated) return c.json(notFound, HttpStatusCodes.NOT_FOUND)

  const channelIds = await agentChannelIds(agent.id)
  // Every Discord-linked channel's @mention role follows the new name.
  if (identityChanged) {
    for (const channelId of channelIds) {
      void syncAgentRole(channelId).catch((err: unknown) =>
        logger.warn({ err, channelId }, "Discord agent role rename failed")
      )
    }
  }
  emitAgentsUpdated(workspace.id)
  return c.json(
    serializeAgent(
      updated,
      await visibleChannelIds(agent.id, currentUser.id, workspace.id)
    ),
    HttpStatusCodes.OK
  )
}

export const deleteAgent: AppRouteHandler<DeleteAgentRoute> = async (c) => {
  const workspace = c.var.workspace
  const { agentId } = c.req.valid("param")
  assertWorkspaceAuthority(c.var.authority, { channel: ["update"] })
  const agent = await visibleAgent(workspace.id, agentId, c.var.user.id)
  if (!agent) return c.json(notFound, HttpStatusCodes.NOT_FOUND)

  const channelIds = await agentChannelIds(agent.id)
  await db.delete(schema.agent).where(eq(schema.agent.id, agent.id))
  // Its channels are left with no agent. Whoever is added next starts a
  // fresh conversation there.
  await Promise.all(
    channelIds.map((channelId) =>
      resetAgentConversation(channelId).catch((err: unknown) =>
        logger.warn({ err, channelId }, "Agent conversation reset failed")
      )
    )
  )
  emitAgentsUpdated(workspace.id)
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

// An agent's facts (reference/always-on-agents.md §7): anyone who can see
// the agent can read, edit and delete them.

async function loadAgentFact(agentId: string, factId: string) {
  const [row] = await db
    .select({
      id: schema.agentFact.id,
      text: schema.agentFact.text,
      source: schema.agentFact.source,
      createdAt: schema.agentFact.createdAt,
      updatedAt: schema.agentFact.updatedAt,
      editorId: schema.user.id,
      editorName: schema.user.name,
    })
    .from(schema.agentFact)
    .leftJoin(schema.user, eq(schema.user.id, schema.agentFact.editedById))
    .where(
      and(
        eq(schema.agentFact.id, factId),
        eq(schema.agentFact.agentId, agentId),
        isNull(schema.agentFact.deletedAt)
      )
    )
  return row ?? null
}

function serializeAgentFact(
  row: NonNullable<Awaited<ReturnType<typeof loadAgentFact>>>
) {
  return {
    id: row.id,
    text: row.text,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editedBy:
      row.editorId && row.editorName
        ? { id: row.editorId, name: row.editorName }
        : null,
  }
}

export const listAgentFacts: AppRouteHandler<ListAgentFactsRoute> = async (
  c
) => {
  const { agentId } = c.req.valid("param")
  const agent = await visibleAgent(c.var.workspace.id, agentId, c.var.user.id)
  if (!agent) return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  const rows = await db
    .select({
      id: schema.agentFact.id,
      text: schema.agentFact.text,
      source: schema.agentFact.source,
      createdAt: schema.agentFact.createdAt,
      updatedAt: schema.agentFact.updatedAt,
      editorId: schema.user.id,
      editorName: schema.user.name,
    })
    .from(schema.agentFact)
    .leftJoin(schema.user, eq(schema.user.id, schema.agentFact.editedById))
    .where(
      and(
        eq(schema.agentFact.agentId, agent.id),
        isNull(schema.agentFact.deletedAt)
      )
    )
    .orderBy(asc(schema.agentFact.createdAt), asc(schema.agentFact.id))
  return c.json({ facts: rows.map(serializeAgentFact) }, HttpStatusCodes.OK)
}

export const updateAgentFact: AppRouteHandler<UpdateAgentFactRoute> = async (
  c
) => {
  const { agentId, factId } = c.req.valid("param")
  const { text } = c.req.valid("json")
  const agent = await visibleAgent(c.var.workspace.id, agentId, c.var.user.id)
  if (!agent) return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  const updated = await db.transaction(async (tx) => {
    await tx.execute(agentProfileLock(agent.id))
    return tx
      .update(schema.agentFact)
      .set({ text, updatedAt: new Date(), editedById: c.var.user.id })
      .where(
        and(
          eq(schema.agentFact.id, factId),
          eq(schema.agentFact.agentId, agent.id),
          isNull(schema.agentFact.deletedAt)
        )
      )
      .returning({ id: schema.agentFact.id })
  })
  const row = updated[0] ? await loadAgentFact(agent.id, factId) : null
  if (!row) {
    return c.json(
      { success: false, message: "Fact not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json(serializeAgentFact(row), HttpStatusCodes.OK)
}

export const deleteAgentFact: AppRouteHandler<DeleteAgentFactRoute> = async (
  c
) => {
  const { agentId, factId } = c.req.valid("param")
  const agent = await visibleAgent(c.var.workspace.id, agentId, c.var.user.id)
  if (!agent) return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  const now = new Date()
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(agentProfileLock(agent.id))
    return tx
      .update(schema.agentFact)
      .set({ deletedAt: now, updatedAt: now, editedById: c.var.user.id })
      .where(
        and(
          eq(schema.agentFact.id, factId),
          eq(schema.agentFact.agentId, agent.id),
          isNull(schema.agentFact.deletedAt)
        )
      )
      .returning({ id: schema.agentFact.id })
  })
  if (deleted.length === 0) {
    return c.json(
      { success: false, message: "Fact not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
