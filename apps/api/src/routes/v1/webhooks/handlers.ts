import { randomBytes } from "node:crypto"
import { db } from "@repo/db"
import { channel, channelWebhook, user } from "@repo/db/schema"
import { env } from "@repo/env/server"
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

const MAX_WEBHOOKS_PER_CHANNEL = 10

// Avatars must live in our public bucket (uploaded via the webhook-avatar
// presign) — never an arbitrary external URL.
function isOwnAssetUrl(url: string) {
  return url.startsWith(`${env.S3_PUBLIC_URL.replace(/\/$/, "")}/`)
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

const toResponse = (
  row: {
    id: string
    name: string
    channelId: string
    avatarUrl: string | null
    token: string
    createdAt: Date
  },
  createdByName: string | null
) => ({
  id: row.id,
  name: row.name,
  channelId: row.channelId,
  avatarUrl: row.avatarUrl,
  token: row.token,
  createdAt: row.createdAt.toISOString(),
  createdByName,
})

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

  const rows = await db
    .select({ webhook: channelWebhook, creatorName: user.name })
    .from(channelWebhook)
    .leftJoin(user, eq(channelWebhook.createdBy, user.id))
    .where(eq(channelWebhook.channelId, channelId))
    .orderBy(channelWebhook.createdAt)

  return c.json(
    { webhooks: rows.map((r) => toResponse(r.webhook, r.creatorName)) },
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

  if (avatarUrl && !isOwnAssetUrl(avatarUrl)) {
    return c.json(
      { success: false, message: "Avatar must be an uploaded asset" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const target = await findTextChannel(channelId, workspace.id)
  if (!target) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const existing = await db
    .select({ value: count() })
    .from(channelWebhook)
    .where(eq(channelWebhook.channelId, channelId))
    .then((rows) => rows[0]?.value ?? 0)
  if (existing >= MAX_WEBHOOKS_PER_CHANNEL) {
    return c.json(
      {
        success: false,
        message: `A channel can have at most ${MAX_WEBHOOKS_PER_CHANNEL} webhooks`,
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const inserted = await db
    .insert(channelWebhook)
    .values({
      channelId,
      workspaceId: workspace.id,
      name,
      avatarUrl: avatarUrl ?? null,
      token: randomBytes(32).toString("base64url"),
      createdBy: c.var.user.id,
    })
    .returning()
    .then((rows) => rows[0])
  if (!inserted) {
    return c.json(
      { success: false, message: "Failed to create webhook" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }

  return c.json(
    { webhook: toResponse(inserted, c.var.user.name) },
    HttpStatusCodes.OK
  )
}

export const updateChannelWebhook: AppRouteHandler<
  UpdateChannelWebhookRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, webhookId } = c.req.valid("param")
  const { name, avatarUrl } = c.req.valid("json")

  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })

  if (avatarUrl && !isOwnAssetUrl(avatarUrl)) {
    return c.json(
      { success: false, message: "Avatar must be an uploaded asset" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const updated = await db
    .update(channelWebhook)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    })
    .where(
      and(
        eq(channelWebhook.id, webhookId),
        eq(channelWebhook.channelId, channelId),
        eq(channelWebhook.workspaceId, workspace.id)
      )
    )
    .returning()
    .then((rows) => rows[0])

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
    { webhook: toResponse(updated, creatorName) },
    HttpStatusCodes.OK
  )
}

export const deleteChannelWebhook: AppRouteHandler<
  DeleteChannelWebhookRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, webhookId } = c.req.valid("param")

  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })

  const deleted = await db
    .delete(channelWebhook)
    .where(
      and(
        eq(channelWebhook.id, webhookId),
        eq(channelWebhook.channelId, channelId),
        eq(channelWebhook.workspaceId, workspace.id)
      )
    )
    .returning({ id: channelWebhook.id })
    .then((rows) => rows[0])

  if (!deleted) {
    return c.json(
      { success: false, message: "Webhook not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
