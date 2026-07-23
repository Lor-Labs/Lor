import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { db } from "@repo/db"
import { channel, workspace, workspaceMember } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { and, eq } from "drizzle-orm"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspacePermission } from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { s3Client } from "@/lib/s3"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  AvatarPresignRoute,
  PresignRoute,
  WebhookAvatarPresignRoute,
  WorkspaceIconPresignRoute,
} from "@/routes/v1/uploads/routes"
import {
  MAX_AVATAR_SIZE,
  MAX_WORKSPACE_ICON_SIZE,
  PRESIGNED_URL_EXPIRY_SECONDS,
} from "@/routes/v1/uploads/schema"

async function createPresignedUpload(
  key: string,
  contentType: string,
  size: number
) {
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  })
  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
  })
  const fileUrl = `${env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`
  return { uploadUrl, fileUrl }
}

export const presign: AppRouteHandler<PresignRoute> = async (c) => {
  const user = c.var.user
  const { channelId, filename, contentType, size } = c.req.valid("json")

  if (size > env.MAX_FILE_UPLOAD_SIZE) {
    return c.json(
      { success: false, message: "File too large" },
      HttpStatusCodes.REQUEST_TOO_LONG
    )
  }

  const canAccess = await userCanAccessChannel(channelId, user.id)
  if (!canAccess) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const fileId = crypto.randomUUID()
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  const key = `attachments/${channelId}/${fileId}/${sanitizedFilename}`
  const { uploadUrl, fileUrl } = await createPresignedUpload(
    key,
    contentType,
    size
  )

  return c.json({ uploadUrl, fileUrl, key }, HttpStatusCodes.OK)
}

export const avatarPresign: AppRouteHandler<AvatarPresignRoute> = async (c) => {
  const user = c.var.user
  const { filename, contentType, size } = c.req.valid("json")

  if (size > MAX_AVATAR_SIZE) {
    return c.json(
      { success: false, message: "File too large" },
      HttpStatusCodes.REQUEST_TOO_LONG
    )
  }

  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  const key = `avatars/${user.id}/${crypto.randomUUID()}/${sanitizedFilename}`
  const { uploadUrl, fileUrl } = await createPresignedUpload(
    key,
    contentType,
    size
  )

  return c.json({ uploadUrl, fileUrl }, HttpStatusCodes.OK)
}

export const webhookAvatarPresign: AppRouteHandler<
  WebhookAvatarPresignRoute
> = async (c) => {
  const user = c.var.user
  const { channelId, filename, contentType, size } = c.req.valid("json")

  if (size > MAX_AVATAR_SIZE) {
    return c.json(
      { success: false, message: "File too large" },
      HttpStatusCodes.REQUEST_TOO_LONG
    )
  }

  // Webhook avatars belong to workspace text channels, managed by members
  // with channel-update permission (same gate as the webhook CRUD routes).
  const ch = await db
    .select({
      workspaceId: channel.workspaceId,
      ownerId: workspace.ownerId,
    })
    .from(channel)
    .innerJoin(workspace, eq(channel.workspaceId, workspace.id))
    .where(and(eq(channel.id, channelId), eq(channel.type, "text")))
    .limit(1)
    .then((rows) => rows[0])
  if (!ch?.workspaceId) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const member = await db
    .select({ role: workspaceMember.role, userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, ch.workspaceId),
        eq(workspaceMember.userId, user.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!member) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  assertWorkspacePermission(
    member,
    { ownerId: ch.ownerId },
    {
      channel: ["update"],
    }
  )

  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  const key = `webhook-avatars/${channelId}/${crypto.randomUUID()}/${sanitizedFilename}`
  const { uploadUrl, fileUrl } = await createPresignedUpload(
    key,
    contentType,
    size
  )

  return c.json({ uploadUrl, fileUrl }, HttpStatusCodes.OK)
}

export const workspaceIconPresign: AppRouteHandler<
  WorkspaceIconPresignRoute
> = async (c) => {
  const user = c.var.user
  const { workspaceId, filename, contentType, size } = c.req.valid("json")

  if (size > MAX_WORKSPACE_ICON_SIZE) {
    return c.json(
      { success: false, message: "File too large" },
      HttpStatusCodes.REQUEST_TOO_LONG
    )
  }

  // Verify workspace exists and user has update permission
  const workspaceRecord = await db
    .select({ ownerId: workspace.ownerId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
    .then((rows) => rows[0])

  if (!workspaceRecord) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const member = await db
    .select({ role: workspaceMember.role, userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, user.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!member) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  assertWorkspacePermission(member, workspaceRecord, {
    organization: ["update"],
  })

  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  const key = `workspace-icons/${workspaceId}/${crypto.randomUUID()}/${sanitizedFilename}`
  const { uploadUrl, fileUrl } = await createPresignedUpload(
    key,
    contentType,
    size
  )

  return c.json({ uploadUrl, fileUrl }, HttpStatusCodes.OK)
}
