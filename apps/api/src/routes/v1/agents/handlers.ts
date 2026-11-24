import { db, schema } from "@repo/db"
import {
  agentChannelIds,
  factsVisibleIn,
  createAgent as insertAgent,
  memberScopes,
} from "@repo/db/queries/agents"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import type { Agent } from "@repo/db/schema"
import { keyFunding } from "@repo/lor/byok"
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

// Agents apart from channels (reference/agents-and-chats.md). Every member
// sees every agent. Managing one (its brief, model, existence) takes
// channel:update, as the channel's agent settings did; the person who made
// an agent may still name it. What it learned in a private channel is shown
// only to that channel's people.

function serializeAgent(agent: Agent, channelIds: string[]) {
  return {
    id: agent.id,
    name: agent.name,
    creature: agent.creature,
    role: agent.role,
    brief: agent.brief,
    model: agent.model,
    createdById: agent.createdById,
    createdAt: agent.createdAt.toISOString(),
    channelIds,
  }
}

const notFound = { success: false as const, message: "Agent not found" }

async function workspaceAgent(
  workspaceId: string,
  agentId: string
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
  return found ?? null
}

// A model an agent may run on: one of Lor's, or one the workspace's own API
// key pays for (`key:provider/model`, as the composer writes it).
async function modelAvailable(workspaceId: string, model: string) {
  return (
    isLorCreditModel(model) || Boolean(await keyFunding(workspaceId, model))
  )
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
    db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.workspaceId, workspace.id))
      .orderBy(asc(schema.agent.createdAt), asc(schema.agent.id)),
    listAccessibleChannelIds(userId, workspace.id),
  ])
  // Only the channels this person can see: a private channel an agent is in
  // stays unnamed to everyone else.
  const placed =
    agents.length > 0
      ? await db
          .select({
            id: schema.channelAgent.channelId,
            agentId: schema.channelAgent.agentId,
          })
          .from(schema.channelAgent)
          .where(
            inArray(
              schema.channelAgent.agentId,
              agents.map((agent) => agent.id)
            )
          )
          .orderBy(asc(schema.channelAgent.createdAt))
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

  if (body.model && !(await modelAvailable(workspace.id, body.model))) {
    return c.json(
      { success: false, message: "Model not available" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const name = body.name ? normalizeAgentName(body.name) : null
  const made = await insertAgent({
    workspaceId: workspace.id,
    name,
    creature: body.creature,
    role: body.role,
    brief: body.brief,
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

  const agent = await workspaceAgent(workspace.id, agentId)
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
  if (
    body.model &&
    body.model !== agent.model &&
    !(await modelAvailable(workspace.id, body.model))
  ) {
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
  const agent = await workspaceAgent(workspace.id, agentId)
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

// An agent's facts (reference/always-on-agents.md §7). A fact learned where
// the whole workspace can see is anyone's to read, edit and delete. One
// learned in a private channel is only its members': to everyone else it
// does not exist (reference/agents-and-chats.md).

const factSelect = {
  id: schema.agentFact.id,
  text: schema.agentFact.text,
  source: schema.agentFact.source,
  createdAt: schema.agentFact.createdAt,
  updatedAt: schema.agentFact.updatedAt,
  editorId: schema.user.id,
  editorName: schema.user.name,
  scopeId: schema.agentFact.scopeChannelId,
  scopeName: schema.channel.name,
}

// This agent's live facts that this person may see.
function visibleFacts(agentId: string, scopes: string[]) {
  return and(
    eq(schema.agentFact.agentId, agentId),
    isNull(schema.agentFact.deletedAt),
    factsVisibleIn(scopes)
  )
}

function factsQuery() {
  return db
    .select(factSelect)
    .from(schema.agentFact)
    .leftJoin(schema.user, eq(schema.user.id, schema.agentFact.editedById))
    .leftJoin(
      schema.channel,
      eq(schema.channel.id, schema.agentFact.scopeChannelId)
    )
}

type FactRow = Awaited<ReturnType<typeof factsQuery>>[number]

function serializeAgentFact(row: FactRow) {
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
    // The private channel or project it was learned in and stays in.
    privateTo: row.scopeId ? { id: row.scopeId, name: row.scopeName } : null,
  }
}

export const listAgentFacts: AppRouteHandler<ListAgentFactsRoute> = async (
  c
) => {
  const { agentId } = c.req.valid("param")
  const agent = await workspaceAgent(c.var.workspace.id, agentId)
  if (!agent) return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  const scopes = await memberScopes(c.var.user.id, c.var.workspace.id)
  const rows = await factsQuery()
    .where(visibleFacts(agent.id, scopes))
    .orderBy(asc(schema.agentFact.createdAt), asc(schema.agentFact.id))
  return c.json({ facts: rows.map(serializeAgentFact) }, HttpStatusCodes.OK)
}

export const updateAgentFact: AppRouteHandler<UpdateAgentFactRoute> = async (
  c
) => {
  const { agentId, factId } = c.req.valid("param")
  const { text } = c.req.valid("json")
  const agent = await workspaceAgent(c.var.workspace.id, agentId)
  if (!agent) return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  const scopes = await memberScopes(c.var.user.id, c.var.workspace.id)
  const mine = and(
    visibleFacts(agent.id, scopes),
    eq(schema.agentFact.id, factId)
  )
  const updated = await db.transaction(async (tx) => {
    await tx.execute(agentProfileLock(agent.id))
    return tx
      .update(schema.agentFact)
      .set({ text, updatedAt: new Date(), editedById: c.var.user.id })
      .where(mine)
      .returning({ id: schema.agentFact.id })
  })
  const [row] = updated[0] ? await factsQuery().where(mine) : []
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
  const agent = await workspaceAgent(c.var.workspace.id, agentId)
  if (!agent) return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  const scopes = await memberScopes(c.var.user.id, c.var.workspace.id)
  const now = new Date()
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(agentProfileLock(agent.id))
    return tx
      .update(schema.agentFact)
      .set({ deletedAt: now, updatedAt: now, editedById: c.var.user.id })
      .where(
        and(visibleFacts(agent.id, scopes), eq(schema.agentFact.id, factId))
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
