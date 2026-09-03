import {
  getWorkspaceAuthorityPosition,
  getWorkspaceRolePosition,
  isWorkspaceRole,
} from "@repo/auth/permissions"
import { syncSeats } from "@repo/billing"
import { and, count, db, desc, eq, ilike, inArray, schema } from "@repo/db"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import { env } from "@repo/env/server"
import { PRESENCE_ONLINE_USERS_SET_KEY } from "@repo/realtime-types"
import { asc } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import {
  assertCanManageWorkspaceMember,
  assertWorkspaceAuthority,
} from "@/lib/permissions"
import { getAvatarColorsByUserId } from "@/lib/queries/messages"
import { getRedisClient } from "@/lib/redis"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  DeleteWorkspaceRoleRoute,
  KickWorkspaceMemberRoute,
  ListWorkspaceMembersRoute,
  SearchMessagesRoute,
  UpdateWorkspaceMemberRoleRoute,
  UpdateWorkspaceRoute,
} from "@/routes/v1/workspaces/routes"

const PRESENCE_MEMBERSHIP_CHUNK_SIZE = 250

async function listOnlineUserIds(userIds: string[]) {
  if (userIds.length === 0) return new Set<string>()

  try {
    const redis = await getRedisClient()
    const membership: boolean[] = []

    for (
      let index = 0;
      index < userIds.length;
      index += PRESENCE_MEMBERSHIP_CHUNK_SIZE
    ) {
      const chunk = userIds.slice(index, index + PRESENCE_MEMBERSHIP_CHUNK_SIZE)
      const chunkMembership = await redis.smIsMember(
        PRESENCE_ONLINE_USERS_SET_KEY,
        chunk
      )
      membership.push(...chunkMembership)
    }

    const onlineIds = userIds.filter((_, index) => membership[index] === true)

    return new Set(onlineIds)
  } catch (error) {
    logger.error({ err: error }, "Failed to read presence from Redis")
    return new Set<string>()
  }
}

function toWorkspaceMemberPresence(
  member: {
    userId: string
    name: string
    username: string | null
    displayUsername: string | null
    image: string | null
    avatarColor: string
    role: string
    isBot: boolean
  },
  ownerId: string,
  onlineUserIds: Set<string>
) {
  // Bots (Merlin) have no socket presence — they're always reachable, so always online.
  const isOnline = member.isBot || onlineUserIds.has(member.userId)
  return {
    userId: member.userId,
    name: member.name,
    username: member.username,
    displayUsername: member.displayUsername,
    image: member.image,
    avatarColor: member.avatarColor,
    role: member.role,
    isOwner: ownerId === member.userId,
    isBot: member.isBot,
    status: isOnline ? ("online" as const) : ("offline" as const),
  }
}

async function getWorkspaceMemberRow(workspaceId: string, userId: string) {
  return db
    .select({
      userId: schema.workspaceMember.userId,
      role: schema.workspaceMember.role,
      name: schema.user.name,
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
      image: schema.user.image,
      avatarColor: schema.workspaceMember.avatarColor,
      isBot: schema.user.isBot,
    })
    .from(schema.workspaceMember)
    .innerJoin(schema.user, eq(schema.workspaceMember.userId, schema.user.id))
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspaceId),
        eq(schema.workspaceMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export const listWorkspaceMembers: AppRouteHandler<
  ListWorkspaceMembersRoute
> = async (c) => {
  const workspace = c.var.workspace

  const memberRows = await db
    .select({
      userId: schema.workspaceMember.userId,
      role: schema.workspaceMember.role,
      name: schema.user.name,
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
      image: schema.user.image,
      avatarColor: schema.workspaceMember.avatarColor,
      isBot: schema.user.isBot,
    })
    .from(schema.workspaceMember)
    .innerJoin(schema.user, eq(schema.workspaceMember.userId, schema.user.id))
    .where(eq(schema.workspaceMember.workspaceId, workspace.id))
    .orderBy(asc(schema.user.name))

  const userIds = memberRows.map((row) => row.userId)
  const onlineUserIds = await listOnlineUserIds(userIds)

  return c.json(
    {
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      ownerId: workspace.ownerId,
      members: memberRows.map((member) =>
        toWorkspaceMemberPresence(member, workspace.ownerId, onlineUserIds)
      ),
    },
    HttpStatusCodes.OK
  )
}

export const updateWorkspaceMemberRole: AppRouteHandler<
  UpdateWorkspaceMemberRoleRoute
> = async (c) => {
  const workspace = c.var.workspace
  const actor = c.var.member
  const { userId } = c.req.valid("param")
  const { role } = c.req.valid("json")

  const actorAuthority = assertWorkspaceAuthority(c.var.authority, {
    workspaceMember: ["role:update"],
  })

  const target = await getWorkspaceMemberRow(workspace.id, userId)

  if (!target) {
    return c.json(
      { success: false, message: "Workspace member not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  assertCanManageWorkspaceMember(actor, target, workspace)

  // Non-owners can assign roles at their own position or below — an admin
  // can promote to admin. Demoting an admin stays owner-only via the
  // moderation hierarchy above (strictly-lower rule).
  if (
    !actorAuthority.isOwner &&
    getWorkspaceRolePosition(role) <
      getWorkspaceAuthorityPosition(actorAuthority)
  ) {
    return c.json(
      { success: false, message: "You cannot assign that role" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  // Validate + assign atomically, holding the custom-role row lock, so a
  // concurrent role deletion (delete + member reassignment) can't interleave
  // and commit a dangling role name onto this member.
  const assigned = await db.transaction(async (tx) => {
    if (!isWorkspaceRole(role)) {
      const customRole = await tx
        .select({ id: schema.workspaceRole.id })
        .from(schema.workspaceRole)
        .where(
          and(
            eq(schema.workspaceRole.workspaceId, workspace.id),
            eq(schema.workspaceRole.role, role)
          )
        )
        .limit(1)
        .for("update")
        .then((rows) => rows[0])
      if (!customRole) return false
    }
    await tx
      .update(schema.workspaceMember)
      .set({ role })
      .where(
        and(
          eq(schema.workspaceMember.workspaceId, workspace.id),
          eq(schema.workspaceMember.userId, userId)
        )
      )
    return true
  })
  if (!assigned) {
    return c.json(
      { success: false, message: "Role not found in this workspace" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const updatedMember = await getWorkspaceMemberRow(workspace.id, userId)

  if (!updatedMember) {
    return c.json(
      { success: false, message: "Workspace member not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const onlineUserIds = await listOnlineUserIds([updatedMember.userId])

  return c.json(
    {
      success: true as const,
      member: toWorkspaceMemberPresence(
        updatedMember,
        workspace.ownerId,
        onlineUserIds
      ),
    },
    HttpStatusCodes.OK
  )
}

export const kickWorkspaceMember: AppRouteHandler<
  KickWorkspaceMemberRoute
> = async (c) => {
  const workspace = c.var.workspace
  const actor = c.var.member
  const { userId } = c.req.valid("param")

  assertWorkspaceAuthority(c.var.authority, {
    workspaceMember: ["kick"],
  })

  const target = await getWorkspaceMemberRow(workspace.id, userId)

  if (!target) {
    return c.json(
      { success: false, message: "Workspace member not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  assertCanManageWorkspaceMember(actor, target, workspace)

  await db
    .delete(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspace.id),
        eq(schema.workspaceMember.userId, userId)
      )
    )

  void syncSeats(workspace.id)

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const deleteWorkspaceRole: AppRouteHandler<
  DeleteWorkspaceRoleRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { roleName } = c.req.valid("param")

  // Same gate as better-auth's role CRUD endpoints (ac statements)
  assertWorkspaceAuthority(c.var.authority, { ac: ["delete"] })

  if (isWorkspaceRole(roleName)) {
    return c.json(
      { success: false, message: "Static roles cannot be deleted" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Delete + reassignment are one transaction so no member is ever left
  // holding a dangling role name (which would degrade them to member-tier
  // access but display a stale role).
  const reassignedMemberIds = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.workspaceRole)
      .where(
        and(
          eq(schema.workspaceRole.workspaceId, workspace.id),
          eq(schema.workspaceRole.role, roleName)
        )
      )
      .returning({ id: schema.workspaceRole.id })
    if (deleted.length === 0) return null

    const reassigned = await tx
      .update(schema.workspaceMember)
      .set({ role: "member" })
      .where(
        and(
          eq(schema.workspaceMember.workspaceId, workspace.id),
          eq(schema.workspaceMember.role, roleName)
        )
      )
      .returning({ userId: schema.workspaceMember.userId })
    return reassigned.map((row) => row.userId)
  })

  if (reassignedMemberIds === null) {
    return c.json(
      { success: false, message: "Role not found in this workspace" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  return c.json(
    { success: true as const, reassignedMemberIds },
    HttpStatusCodes.OK
  )
}

// ── Workspace Settings ─────────────────────────────────────

export const updateWorkspace: AppRouteHandler<UpdateWorkspaceRoute> = async (
  c
) => {
  const workspace = c.var.workspace

  assertWorkspaceAuthority(c.var.authority, {
    organization: ["update"],
  })

  const body = c.req.valid("json")

  const workspaceIconPrefix = `${env.S3_PUBLIC_URL.replace(/\/$/, "")}/workspace-icons/${workspace.id}/`
  if (body.logo && !body.logo.startsWith(workspaceIconPrefix)) {
    throw new HTTPException(HttpStatusCodes.BAD_REQUEST, {
      message: "Invalid logo URL",
    })
  }

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.logo !== undefined) updates.logo = body.logo

  if (Object.keys(updates).length === 0) {
    return c.json(
      {
        success: true as const,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          logo: workspace.logo,
        },
      },
      HttpStatusCodes.OK
    )
  }

  const [updated] = await db
    .update(schema.workspace)
    .set(updates)
    .where(eq(schema.workspace.id, workspace.id))
    .returning({
      id: schema.workspace.id,
      name: schema.workspace.name,
      slug: schema.workspace.slug,
      logo: schema.workspace.logo,
    })

  if (!updated) {
    return c.json(
      { success: false, message: "Workspace not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  return c.json(
    {
      success: true as const,
      workspace: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        logo: updated.logo,
      },
    },
    HttpStatusCodes.OK
  )
}

// ── Search ──────────────────────────────────────────────

export const searchMessages: AppRouteHandler<SearchMessagesRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { query, channelId, page, perPage } = c.req.valid("query")
  const offset = (page - 1) * perPage

  const [allWorkspaceChannels, accessibleIds] = await Promise.all([
    db
      .select({
        id: schema.channel.id,
        name: schema.channel.name,
      })
      .from(schema.channel)
      .where(
        and(
          eq(schema.channel.workspaceId, workspace.id),
          eq(schema.channel.type, "text")
        )
      ),
    listAccessibleChannelIds(currentUser.id, workspace.id),
  ])
  // Search never crosses the audience boundary — restricted channels the
  // caller isn't in are excluded before any content is matched.
  const workspaceChannels = allWorkspaceChannels.filter((ch) =>
    accessibleIds.has(ch.id)
  )

  const emptyResult = {
    itemsTotal: 0,
    currentPage: page,
    nextPage: null,
    prevPage: null,
    data: [],
  }

  if (workspaceChannels.length === 0) {
    return c.json(emptyResult, HttpStatusCodes.OK)
  }

  const channelMap = new Map(workspaceChannels.map((ch) => [ch.id, ch.name]))
  const searchChannelIds = channelId
    ? workspaceChannels.filter((ch) => ch.id === channelId).map((ch) => ch.id)
    : workspaceChannels.map((ch) => ch.id)

  if (searchChannelIds.length === 0) {
    return c.json(emptyResult, HttpStatusCodes.OK)
  }

  const escaped = query.replace(/[%_\\]/g, (ch) => `\\${ch}`)
  const searchPattern = `%${escaped}%`
  const whereConditions = and(
    inArray(schema.message.channelId, searchChannelIds),
    ilike(schema.message.content, searchPattern)
  )

  const [countResult, messages] = await Promise.all([
    db.select({ total: count() }).from(schema.message).where(whereConditions),
    db
      .select({
        id: schema.message.id,
        content: schema.message.content,
        createdAt: schema.message.createdAt,
        channelId: schema.message.channelId,
        threadRootId: schema.message.threadRootId,
        author: {
          id: schema.user.id,
          name: schema.user.name,
          username: schema.user.username,
          displayUsername: schema.user.displayUsername,
          image: schema.user.image,
        },
      })
      .from(schema.message)
      .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
      .where(whereConditions)
      .orderBy(desc(schema.message.createdAt))
      .limit(perPage)
      .offset(offset),
  ])

  const itemsTotal = countResult[0]?.total ?? 0
  const totalPages = Math.ceil(itemsTotal / perPage)
  const messageIds = messages.map((message) => message.id)
  const mentionRows =
    messageIds.length > 0
      ? await db
          .select({
            messageId: schema.messageMention.messageId,
            id: schema.user.id,
            name: schema.user.name,
            username: schema.user.username,
            displayUsername: schema.user.displayUsername,
            image: schema.user.image,
          })
          .from(schema.messageMention)
          .innerJoin(
            schema.user,
            eq(schema.messageMention.mentionedUserId, schema.user.id)
          )
          .where(
            and(
              inArray(schema.messageMention.messageId, messageIds),
              eq(schema.messageMention.mentionType, "direct")
            )
          )
      : []
  const mentionsByMessageId = new Map<string, typeof mentionRows>()
  for (const mention of mentionRows) {
    const current = mentionsByMessageId.get(mention.messageId) ?? []
    current.push(mention)
    mentionsByMessageId.set(mention.messageId, current)
  }

  const avatarColorByUserId = await getAvatarColorsByUserId(
    { workspaceId: workspace.id },
    [
      ...messages.map((msg) => msg.author.id),
      ...mentionRows.map((mention) => mention.id),
    ]
  )

  return c.json(
    {
      itemsTotal,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      data: messages.map((msg) => ({
        id: msg.id,
        content: msg.content ?? "",
        createdAt: msg.createdAt.toISOString(),
        channelId: msg.channelId,
        channelName: channelMap.get(msg.channelId) ?? "unknown",
        threadRootId: msg.threadRootId,
        author: {
          id: msg.author.id,
          name: msg.author.name,
          username: msg.author.username,
          displayUsername: msg.author.displayUsername,
          image: msg.author.image,
          avatarColor: avatarColorByUserId.get(msg.author.id) ?? null,
        },
        mentions: (mentionsByMessageId.get(msg.id) ?? []).map((mention) => ({
          id: mention.id,
          name: mention.name,
          username: mention.username,
          displayUsername: mention.displayUsername,
          image: mention.image,
          avatarColor: avatarColorByUserId.get(mention.id) ?? null,
        })),
      })),
    },
    HttpStatusCodes.OK
  )
}
