import { randomBytes, randomUUID } from "node:crypto"
import { db } from "@repo/db"
import { agentIdsByChannel } from "@repo/db/queries/agents"
import {
  listAccessibleChannelIds,
  resolveChannelAccess,
} from "@repo/db/queries/channel-access"
import {
  type ActSessionMode,
  channel,
  connectorTrigger,
  integrationConnection,
  user,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { and, count, eq } from "drizzle-orm"
import { actCodeChanged, actCodeOf, checkActTarget } from "@/lib/act-target"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { type LastAct, lastActByTrigger } from "@/lib/last-act"
import { assertWorkspaceAuthority } from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  CreateChannelWebhookRoute,
  DeleteChannelWebhookRoute,
  ListAgentWebhooksRoute,
  ListChannelWebhooksRoute,
  UpdateChannelWebhookRoute,
} from "@/routes/v1/webhooks/routes"

// A webhook = one `webhook`-provider connection row + its channel-anchored
// trigger, created and managed together. The webhook id in the execute URL is
// the connection's externalId. See reference/automation-primitives.md §3.
// It is a listener like a connector event's (reference/agents-and-chats.md,
// decision 40): an agent hears it and reports in the chat it is anchored to.
// It is made from that chat or from the agent's page.

const MAX_WEBHOOKS_PER_CHANNEL = 10

// Avatars must come from this channel's webhook-avatar presign namespace —
// never an arbitrary external URL or another asset in our bucket.
function isOwnWebhookAvatarUrl(url: string, channelId: string) {
  const base = env.S3_PUBLIC_URL.replace(/\/$/, "")
  return url.startsWith(`${base}/webhook-avatars/${channelId}/`)
}

type WebhookRow = {
  externalId: string
  name: string | null
  avatarUrl: string | null
  accessToken: string | null
  createdAt: Date
  channelId: string
  agentId: string | null
  post: boolean
  notify: boolean
  filter: string | null
  actInstructions: string | null
  actSessionMode: ActSessionMode
  actRepoFullName: string | null
  actBaseBranch: string | null
  actWindowSeconds: number
}

function toResponse(
  row: WebhookRow,
  createdByName: string | null,
  key: string,
  lastAct: LastAct | null,
  // The chat's first agent, which hears a webhook that names none.
  firstAgentId: string | null
) {
  let token = ""
  try {
    token = row.accessToken ? decryptSecret(row.accessToken, key) : ""
  } catch {
    // Undecryptable token (rotated key): surface the row, but the URL is dead.
  }
  return {
    id: row.externalId,
    name: row.name ?? "Webhook",
    channelId: row.channelId,
    agentId: row.agentId ?? firstAgentId,
    avatarUrl: row.avatarUrl,
    token,
    createdAt: row.createdAt.toISOString(),
    createdByName,
    post: row.post,
    notify: row.notify,
    filter: row.filter,
    actInstructions: row.actInstructions,
    actSessionMode: row.actSessionMode,
    actCode: actCodeOf(row),
    actWindowSeconds: row.actWindowSeconds,
    lastAct,
  }
}

const webhookSelection = {
  externalId: integrationConnection.externalId,
  name: integrationConnection.accountLogin,
  avatarUrl: integrationConnection.avatarUrl,
  accessToken: integrationConnection.accessToken,
  createdAt: integrationConnection.createdAt,
  channelId: connectorTrigger.channelId,
  agentId: connectorTrigger.agentId,
  post: connectorTrigger.post,
  notify: connectorTrigger.notify,
  filter: connectorTrigger.filter,
  actInstructions: connectorTrigger.actInstructions,
  actSessionMode: connectorTrigger.actSessionMode,
  actRepoFullName: connectorTrigger.actRepoFullName,
  actBaseBranch: connectorTrigger.actBaseBranch,
  actWindowSeconds: connectorTrigger.actWindowSeconds,
}

// Webhooks post into the channel feed, so only text channels host them.
async function findTextChannel(channelId: string, workspaceId: string) {
  return db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(
        eq(channel.id, channelId),
        eq(channel.workspaceId, workspaceId),
        eq(channel.type, "text")
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

// Resolve one webhook scoped to this workspace + channel, or null.
async function findWebhook(
  workspaceId: string,
  channelId: string,
  webhookId: string
) {
  return db
    .select({
      connectionId: integrationConnection.id,
      triggerId: connectorTrigger.id,
      createdBy: integrationConnection.createdBy,
      ...webhookSelection,
    })
    .from(integrationConnection)
    .innerJoin(
      connectorTrigger,
      eq(connectorTrigger.connectionId, integrationConnection.id)
    )
    .where(
      and(
        eq(integrationConnection.provider, "webhook"),
        eq(integrationConnection.externalId, webhookId),
        eq(integrationConnection.workspaceId, workspaceId),
        eq(connectorTrigger.channelId, channelId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export const listChannelWebhooks: AppRouteHandler<
  ListChannelWebhooksRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId } = c.req.valid("param")

  // Listing exposes tokens, so it's gated like management.
  assertWorkspaceAuthority(c.var.authority, { webhook: ["manage"] })

  if (!(await userCanAccessChannel(channelId, c.var.user.id))) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const target = await findTextChannel(channelId, workspace.id)
  if (!target) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    // Same misconfiguration surface as create/update — an empty list would
    // just look like "no webhooks".
    return c.json(
      {
        success: false,
        message: "Webhooks require INTEGRATION_ENCRYPTION_KEY to be configured",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const rows = await db
    .select({
      ...webhookSelection,
      triggerId: connectorTrigger.id,
      creatorName: user.name,
    })
    .from(integrationConnection)
    .innerJoin(
      connectorTrigger,
      eq(connectorTrigger.connectionId, integrationConnection.id)
    )
    .leftJoin(user, eq(integrationConnection.createdBy, user.id))
    .where(
      and(
        eq(integrationConnection.provider, "webhook"),
        eq(integrationConnection.workspaceId, workspace.id),
        eq(connectorTrigger.channelId, channelId)
      )
    )
    .orderBy(integrationConnection.createdAt)

  const lastActs = await lastActByTrigger(
    rows.map((row) => row.triggerId),
    [channelId]
  )
  const firstAgentId = await firstAgentOf(channelId)

  return c.json(
    {
      webhooks: rows.map((row) =>
        toResponse(
          row,
          row.creatorName,
          key,
          lastActs.get(row.triggerId) ?? null,
          firstAgentId
        )
      ),
    },
    HttpStatusCodes.OK
  )
}

async function firstAgentOf(channelId: string): Promise<string | null> {
  return (await agentIdsByChannel([channelId])).get(channelId)?.[0] ?? null
}

// The webhooks an agent hears, for its own page: the ones that name it, and
// the ones that name nobody in a chat where it is the first agent. Only in
// chats the caller can see.
export const listAgentWebhooks: AppRouteHandler<
  ListAgentWebhooksRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { agentId } = c.req.valid("param")

  // Listing exposes tokens, so it's gated like management.
  assertWorkspaceAuthority(c.var.authority, { webhook: ["manage"] })

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return c.json(
      {
        success: false,
        message: "Webhooks require INTEGRATION_ENCRYPTION_KEY to be configured",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const [rows, accessible] = await Promise.all([
    db
      .select({
        ...webhookSelection,
        triggerId: connectorTrigger.id,
        creatorName: user.name,
      })
      .from(integrationConnection)
      .innerJoin(
        connectorTrigger,
        eq(connectorTrigger.connectionId, integrationConnection.id)
      )
      .leftJoin(user, eq(integrationConnection.createdBy, user.id))
      .where(
        and(
          eq(integrationConnection.provider, "webhook"),
          eq(integrationConnection.workspaceId, workspace.id)
        )
      )
      .orderBy(integrationConnection.createdAt),
    listAccessibleChannelIds(c.var.user.id, workspace.id),
  ])
  const visible = rows.filter((row) => accessible.has(row.channelId))
  const firstAgents = await agentIdsByChannel([
    ...new Set(
      visible.filter((row) => !row.agentId).map((row) => row.channelId)
    ),
  ])
  const firstAgentOfRow = (row: (typeof rows)[number]) =>
    firstAgents.get(row.channelId)?.[0] ?? null
  const heard = visible.filter(
    (row) => (row.agentId ?? firstAgentOfRow(row)) === agentId
  )
  const lastActs = await lastActByTrigger(
    heard.map((row) => row.triggerId),
    [...new Set(heard.map((row) => row.channelId))]
  )

  return c.json(
    {
      webhooks: heard.map((row) =>
        toResponse(
          row,
          row.creatorName,
          key,
          lastActs.get(row.triggerId) ?? null,
          firstAgentOfRow(row)
        )
      ),
    },
    HttpStatusCodes.OK
  )
}

// Archived channels are read-only: listing stays available, mutations reject.
// Denied access reads as not_found (fail closed, no leak).
async function checkChannelWriteAccess(
  userId: string,
  channelId: string
): Promise<"ok" | "not_found" | "archived"> {
  const access = await resolveChannelAccess(userId, channelId)
  if (!access.ok) return "not_found"
  if (!access.access.canWrite) return "archived"
  return "ok"
}

export const createChannelWebhook: AppRouteHandler<
  CreateChannelWebhookRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId } = c.req.valid("param")
  const { name, avatarUrl, agentId } = c.req.valid("json")

  assertWorkspaceAuthority(c.var.authority, { webhook: ["manage"] })

  const writeAccess = await checkChannelWriteAccess(c.var.user.id, channelId)
  if (writeAccess === "not_found") {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (writeAccess === "archived") {
    return c.json(
      { success: false, message: "Channel is archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return c.json(
      {
        success: false,
        message: "Webhooks require INTEGRATION_ENCRYPTION_KEY to be configured",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (avatarUrl && !isOwnWebhookAvatarUrl(avatarUrl, channelId)) {
    return c.json(
      { success: false, message: "Avatar must be an uploaded asset" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // The agent that hears it reports in this chat, so it has to be in it.
  const inChat = (await agentIdsByChannel([channelId])).get(channelId) ?? []
  if (agentId && !inChat.includes(agentId)) {
    return c.json(
      { success: false, message: "That agent is not in this chat" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const token = randomBytes(32).toString("base64url")

  // Lock the channel row so concurrent creates serialize and the cap check
  // can't be raced past.
  const result = await db.transaction(async (tx) => {
    const target = await tx
      .select({ id: channel.id })
      .from(channel)
      .where(
        and(
          eq(channel.id, channelId),
          eq(channel.workspaceId, workspace.id),
          eq(channel.type, "text")
        )
      )
      .limit(1)
      .for("update")
      .then((rows) => rows[0] ?? null)
    if (!target) return { status: "not_found" as const }

    const existing = await tx
      .select({ value: count() })
      .from(connectorTrigger)
      .innerJoin(
        integrationConnection,
        eq(connectorTrigger.connectionId, integrationConnection.id)
      )
      .where(
        and(
          eq(connectorTrigger.channelId, channelId),
          eq(integrationConnection.provider, "webhook")
        )
      )
      .then((rows) => rows[0]?.value ?? 0)
    if (existing >= MAX_WEBHOOKS_PER_CHANNEL) {
      return { status: "limit" as const }
    }

    const connection = await tx
      .insert(integrationConnection)
      .values({
        workspaceId: workspace.id,
        provider: "webhook",
        externalId: randomUUID(),
        accountLogin: name,
        avatarUrl: avatarUrl ?? null,
        accessToken: encryptSecret(token, key),
        createdBy: c.var.user.id,
      })
      .returning()
      .then((rows) => rows[0])
    if (!connection) return { status: "failed" as const }

    const trigger = await tx
      .insert(connectorTrigger)
      .values({
        connectionId: connection.id,
        event: "data_received",
        channelId,
        // Made for an agent, it wakes that agent, which decides what to
        // say; made from a chat, the data is posted there.
        ...(agentId
          ? { agentId, post: false, actInstructions: "" }
          : { post: true }),
        configuredById: c.var.user.id,
      })
      .returning()
      .then((rows) => rows[0])
    if (!trigger) return { status: "failed" as const }

    return { status: "created" as const, connection, trigger }
  })

  if (result.status === "not_found") {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (result.status === "limit") {
    return c.json(
      {
        success: false,
        message: `A channel can have at most ${MAX_WEBHOOKS_PER_CHANNEL} webhooks`,
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (result.status === "failed") {
    return c.json(
      { success: false, message: "Failed to create webhook" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }

  return c.json(
    {
      webhook: toResponse(
        {
          externalId: result.connection.externalId,
          name: result.connection.accountLogin,
          avatarUrl: result.connection.avatarUrl,
          accessToken: result.connection.accessToken,
          createdAt: result.connection.createdAt,
          channelId: result.trigger.channelId,
          agentId: result.trigger.agentId,
          post: result.trigger.post,
          notify: result.trigger.notify,
          filter: result.trigger.filter,
          actInstructions: result.trigger.actInstructions,
          actSessionMode: result.trigger.actSessionMode,
          actRepoFullName: result.trigger.actRepoFullName,
          actBaseBranch: result.trigger.actBaseBranch,
          actWindowSeconds: result.trigger.actWindowSeconds,
        },
        c.var.user.name,
        key,
        null,
        inChat[0] ?? null
      ),
    },
    HttpStatusCodes.OK
  )
}

export const updateChannelWebhook: AppRouteHandler<
  UpdateChannelWebhookRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, webhookId } = c.req.valid("param")
  const {
    name,
    avatarUrl,
    channelId: nextChannelId,
    agentId: nextAgentId,
    post,
    notify,
    filter,
    actInstructions,
    actSessionMode,
    actCode,
    actWindowSeconds,
  } = c.req.valid("json")

  assertWorkspaceAuthority(c.var.authority, { webhook: ["manage"] })

  const writeAccess = await checkChannelWriteAccess(c.var.user.id, channelId)
  if (writeAccess === "not_found") {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (writeAccess === "archived") {
    return c.json(
      { success: false, message: "Channel is archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return c.json(
      { success: false, message: "Webhooks are unavailable" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (avatarUrl && !isOwnWebhookAvatarUrl(avatarUrl, channelId)) {
    return c.json(
      { success: false, message: "Avatar must be an uploaded asset" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const existing = await findWebhook(workspace.id, channelId, webhookId)
  if (!existing) {
    return c.json(
      { success: false, message: "Webhook not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // Moved to another chat: the mover has to be able to write there, and
  // the chat has room for it.
  const moveTo =
    nextChannelId && nextChannelId !== channelId ? nextChannelId : null
  if (moveTo) {
    const movable =
      (await checkChannelWriteAccess(c.var.user.id, moveTo)) === "ok" &&
      (await findTextChannel(moveTo, workspace.id))
    if (!movable) {
      return c.json(
        { success: false, message: "Chat not found" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }
  const chatId = moveTo ?? channelId
  // Its agent reports in the chat, so it has to be in it.
  const listening = nextAgentId ?? (moveTo ? existing.agentId : null)
  if (listening) {
    const inChat = (await agentIdsByChannel([chatId])).get(chatId) ?? []
    if (!inChat.includes(listening)) {
      return c.json(
        { success: false, message: "That agent is not in this chat" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

  let target =
    actSessionMode !== undefined || actCode !== undefined || moveTo
      ? await checkActTarget({
          workspaceId: workspace.id,
          channelId: chatId,
          sessionMode: actSessionMode ?? existing.actSessionMode,
          code: actCode !== undefined ? actCode : actCodeOf(existing),
          recheck: !!moveTo || actCodeChanged(actCode, actCodeOf(existing)),
        })
      : null
  // A saved repository the new chat can't use is dropped with the move: it
  // is only a hint to the agent.
  if (target && !target.ok && moveTo && actCode === undefined) {
    target = {
      ok: true,
      columns: { actRepoFullName: null, actBaseBranch: null },
    }
  }
  if (target && !target.ok) {
    return c.json(
      { success: false, message: target.message },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // One transaction so a patch touching both rows can't half-apply.
  const full = await db.transaction(async (tx) => {
    if (moveTo) {
      // The destination row is locked as createWebhook does, so a move and a
      // create can't both take the last slot.
      await tx
        .select({ id: channel.id })
        .from(channel)
        .where(eq(channel.id, moveTo))
        .for("update")
      const there = await tx
        .select({ value: count() })
        .from(connectorTrigger)
        .innerJoin(
          integrationConnection,
          eq(connectorTrigger.connectionId, integrationConnection.id)
        )
        .where(
          and(
            eq(connectorTrigger.channelId, moveTo),
            eq(integrationConnection.provider, "webhook")
          )
        )
        .then((rows) => rows[0]?.value ?? 0)
      if (there >= MAX_WEBHOOKS_PER_CHANNEL) return true
    }
    if (name !== undefined || avatarUrl !== undefined) {
      await tx
        .update(integrationConnection)
        .set({
          ...(name !== undefined ? { accountLogin: name } : {}),
          ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        })
        .where(eq(integrationConnection.id, existing.connectionId))
    }
    if (
      moveTo ||
      nextAgentId !== undefined ||
      post !== undefined ||
      notify !== undefined ||
      filter !== undefined ||
      actInstructions !== undefined ||
      target ||
      actWindowSeconds !== undefined
    ) {
      await tx
        .update(connectorTrigger)
        .set({
          configuredById: c.var.user.id,
          ...(moveTo ? { channelId: moveTo } : {}),
          ...(nextAgentId !== undefined ? { agentId: nextAgentId } : {}),
          ...(post !== undefined ? { post } : {}),
          ...(notify !== undefined ? { notify } : {}),
          ...(filter !== undefined ? { filter: filter?.trim() || null } : {}),
          ...(actInstructions !== undefined ? { actInstructions } : {}),
          ...(actSessionMode !== undefined ? { actSessionMode } : {}),
          ...(target?.ok ? target.columns : {}),
          ...(actWindowSeconds !== undefined ? { actWindowSeconds } : {}),
        })
        .where(eq(connectorTrigger.id, existing.triggerId))
    }
    return false
  })
  if (full) {
    return c.json(
      {
        success: false,
        message: `A channel can have at most ${MAX_WEBHOOKS_PER_CHANNEL} webhooks`,
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const updated = await findWebhook(workspace.id, chatId, webhookId)
  if (!updated) {
    return c.json(
      { success: false, message: "Webhook not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const creatorName = updated.createdBy
    ? await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, updated.createdBy))
        .limit(1)
        .then((rows) => rows[0]?.name ?? null)
    : null

  const lastActs = await lastActByTrigger([updated.triggerId], [chatId])

  return c.json(
    {
      webhook: toResponse(
        updated,
        creatorName,
        key,
        lastActs.get(updated.triggerId) ?? null,
        await firstAgentOf(chatId)
      ),
    },
    HttpStatusCodes.OK
  )
}

export const deleteChannelWebhook: AppRouteHandler<
  DeleteChannelWebhookRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, webhookId } = c.req.valid("param")

  assertWorkspaceAuthority(c.var.authority, { webhook: ["manage"] })

  const writeAccess = await checkChannelWriteAccess(c.var.user.id, channelId)
  if (writeAccess === "not_found") {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (writeAccess === "archived") {
    return c.json(
      { success: false, message: "Channel is archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const existing = await findWebhook(workspace.id, channelId, webhookId)
  if (!existing) {
    return c.json(
      { success: false, message: "Webhook not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // The trigger (and its deliveries) cascade off the connection.
  await db
    .delete(integrationConnection)
    .where(eq(integrationConnection.id, existing.connectionId))

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
