import { randomBytes, randomUUID } from "node:crypto"
import { db } from "@repo/db"
import {
  channel,
  connectorTrigger,
  integrationConnection,
  user,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { and, count, eq } from "drizzle-orm"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspacePermission } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  CreateChannelWebhookRoute,
  DeleteChannelWebhookRoute,
  ListChannelWebhooksRoute,
  UpdateChannelWebhookRoute,
} from "@/routes/v1/webhooks/routes"

// A webhook = one `webhook`-provider connection row + its channel-anchored
// trigger, created and managed together. The webhook id in the execute URL is
// the connection's externalId. See reference/automation-primitives.md §3.

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
  post: boolean
  remember: boolean
  rememberHint: string | null
  actInstructions: string | null
}

function toResponse(
  row: WebhookRow,
  createdByName: string | null,
  key: string
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
    avatarUrl: row.avatarUrl,
    token,
    createdAt: row.createdAt.toISOString(),
    createdByName,
    post: row.post,
    remember: row.remember,
    rememberHint: row.rememberHint,
    actInstructions: row.actInstructions,
  }
}

const webhookSelection = {
  externalId: integrationConnection.externalId,
  name: integrationConnection.accountLogin,
  avatarUrl: integrationConnection.avatarUrl,
  accessToken: integrationConnection.accessToken,
  createdAt: integrationConnection.createdAt,
  channelId: connectorTrigger.channelId,
  post: connectorTrigger.post,
  remember: connectorTrigger.remember,
  rememberHint: connectorTrigger.rememberHint,
  actInstructions: connectorTrigger.actInstructions,
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
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })

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
    .select({ ...webhookSelection, creatorName: user.name })
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

  return c.json(
    { webhooks: rows.map((row) => toResponse(row, row.creatorName, key)) },
    HttpStatusCodes.OK
  )
}

export const createChannelWebhook: AppRouteHandler<
  CreateChannelWebhookRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId } = c.req.valid("param")
  const { name, avatarUrl } = c.req.valid("json")

  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })

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
        post: true,
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
          post: result.trigger.post,
          remember: result.trigger.remember,
          rememberHint: result.trigger.rememberHint,
          actInstructions: result.trigger.actInstructions,
        },
        c.var.user.name,
        key
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
  const { name, avatarUrl, post, remember, rememberHint, actInstructions } =
    c.req.valid("json")

  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })

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

  // One transaction so a patch touching both rows can't half-apply.
  await db.transaction(async (tx) => {
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
      post !== undefined ||
      remember !== undefined ||
      rememberHint !== undefined ||
      actInstructions !== undefined
    ) {
      await tx
        .update(connectorTrigger)
        .set({
          ...(post !== undefined ? { post } : {}),
          ...(remember !== undefined ? { remember } : {}),
          ...(rememberHint !== undefined ? { rememberHint } : {}),
          ...(actInstructions !== undefined ? { actInstructions } : {}),
        })
        .where(eq(connectorTrigger.id, existing.triggerId))
    }
  })

  const updated = await findWebhook(workspace.id, channelId, webhookId)
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

  return c.json(
    { webhook: toResponse(updated, creatorName, key) },
    HttpStatusCodes.OK
  )
}

export const deleteChannelWebhook: AppRouteHandler<
  DeleteChannelWebhookRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, webhookId } = c.req.valid("param")

  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })

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
