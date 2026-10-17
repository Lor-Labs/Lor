import { auth } from "@repo/auth"
import {
  getWorkspaceAuthorityPosition,
  getWorkspaceRolePosition,
  isWorkspaceRole,
} from "@repo/auth/permissions"
import { syncSeats } from "@repo/billing"
import {
  and,
  count,
  db,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  notInArray,
  schema,
} from "@repo/db"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import { visibleToSessionChatFilter } from "@repo/db/queries/session-chat-access"
import { env } from "@repo/env/server"
import {
  PRESENCE_ONLINE_USERS_SET_KEY,
  workspaceRoom,
} from "@repo/realtime-types"
import { normalizeDomain } from "@repo/utils/domain"
import { workspaceKey } from "@repo/utils/short-code"
import { asc } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"
import { publishRealtime } from "@/lib/bot-messages"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import {
  assertCanManageWorkspaceMember,
  assertWorkspaceAuthority,
} from "@/lib/permissions"
import { getAvatarColorsByUserId } from "@/lib/queries/messages"
import { getRedisClient } from "@/lib/redis"
import { fetchSiteIcon, storeWorkspaceIcon } from "@/lib/site-icon"
import { disconnectUserSockets } from "@/lib/socket-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import {
  addWorkspaceMember,
  afterWorkspaceJoin,
  verifiedCompanyDomain,
} from "@/lib/workspace-membership"
import type {
  CompleteWorkspaceSetupRoute,
  CreateWorkspaceRoute,
  DeleteWorkspaceRoleRoute,
  JoinWorkspaceRoute,
  KickWorkspaceMemberRoute,
  ListJoinableWorkspacesRoute,
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
    image: string | null
    avatarColor: string
    role: string
    isBot: boolean
  },
  ownerId: string,
  onlineUserIds: Set<string>
) {
  // Bots (Lor) have no socket presence — they're always reachable, so always online.
  const isOnline = member.isBot || onlineUserIds.has(member.userId)
  return {
    userId: member.userId,
    name: member.name,
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

  await disconnectUserSockets(userId)

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

const workspaceSummaryColumns = {
  id: schema.workspace.id,
  name: schema.workspace.name,
  slug: schema.workspace.slug,
  logo: schema.workspace.logo,
  description: schema.workspace.description,
  website: schema.workspace.website,
  joinDomain: schema.workspace.joinDomain,
}

// Empty input clears the field; the request schema already rejected
// anything normalizeDomain can't parse.
function websiteValue(input: string | null): string | null {
  return input ? normalizeDomain(input) : null
}

// Where a creator or joiner lands: the first top-level text channel.
async function firstTextChannelId(workspaceId: string) {
  return db
    .select({ id: schema.channel.id })
    .from(schema.channel)
    .where(
      and(
        eq(schema.channel.workspaceId, workspaceId),
        isNull(schema.channel.parentId),
        eq(schema.channel.type, "text")
      )
    )
    .orderBy(asc(schema.channel.position))
    .limit(1)
    .then((rows) => rows[0]?.id ?? null)
}

export const createWorkspace: AppRouteHandler<CreateWorkspaceRoute> = async (
  c
) => {
  const user = c.var.user
  const body = c.req.valid("json")
  const website = websiteValue(body.website ?? null)
  // Fetched while the template seeds, so the icon adds no wait.
  const siteIcon = website ? fetchSiteIcon(website) : null

  // No headers + userId makes this a better-auth system action: its hooks
  // still seed channels, Lor, and the owner membership.
  const created = await auth.api.createOrganization({
    body: { name: body.name, slug: workspaceKey(), userId: user.id },
  })
  if (!created) {
    throw new HTTPException(HttpStatusCodes.INTERNAL_SERVER_ERROR, {
      message: "Couldn't create the workspace",
    })
  }

  const [workspace] = await db
    .update(schema.workspace)
    .set({
      description: body.description || null,
      website,
      // Join by email domain starts on when the creator's verified domain
      // qualifies; setup and General settings can turn it off.
      joinDomain: verifiedCompanyDomain(user),
    })
    .where(eq(schema.workspace.id, created.id))
    .returning(workspaceSummaryColumns)
  if (!workspace) {
    throw new HTTPException(HttpStatusCodes.INTERNAL_SERVER_ERROR, {
      message: "Couldn't create the workspace",
    })
  }

  // The icon is best effort, so it lands after the setup fields are saved.
  const icon = await siteIcon
  const logo = icon ? await storeWorkspaceIcon(created.id, icon) : null
  if (logo) {
    await db
      .update(schema.workspace)
      .set({ logo })
      .where(eq(schema.workspace.id, created.id))
  }

  return c.json(
    {
      workspace: { ...workspace, logo: logo ?? workspace.logo },
      firstChannelId: await firstTextChannelId(workspace.id),
    },
    HttpStatusCodes.CREATED
  )
}

export const listJoinableWorkspaces: AppRouteHandler<
  ListJoinableWorkspacesRoute
> = async (c) => {
  const user = c.var.user
  const domain = verifiedCompanyDomain(user)
  if (!domain) return c.json({ workspaces: [] }, HttpStatusCodes.OK)

  const workspaces = await db
    .select({
      id: schema.workspace.id,
      slug: schema.workspace.slug,
      name: schema.workspace.name,
      logo: schema.workspace.logo,
      humanMemberCount: count(schema.workspaceMember.id),
    })
    .from(schema.workspace)
    .innerJoin(
      schema.workspaceMember,
      eq(schema.workspaceMember.workspaceId, schema.workspace.id)
    )
    .innerJoin(schema.user, eq(schema.user.id, schema.workspaceMember.userId))
    .where(
      and(
        eq(schema.workspace.joinDomain, domain),
        eq(schema.user.isBot, false),
        notInArray(
          schema.workspace.id,
          db
            .select({ id: schema.workspaceMember.workspaceId })
            .from(schema.workspaceMember)
            .where(eq(schema.workspaceMember.userId, user.id))
        )
      )
    )
    .groupBy(schema.workspace.id)
    .orderBy(desc(count(schema.workspaceMember.id)))

  return c.json({ workspaces }, HttpStatusCodes.OK)
}

export const joinWorkspace: AppRouteHandler<JoinWorkspaceRoute> = async (c) => {
  const user = c.var.user
  const { workspaceSlug } = c.req.valid("param")
  const domain = verifiedCompanyDomain(user)

  const workspace = await db
    .select({
      id: schema.workspace.id,
      slug: schema.workspace.slug,
      name: schema.workspace.name,
      joinDomain: schema.workspace.joinDomain,
    })
    .from(schema.workspace)
    .where(eq(schema.workspace.slug, workspaceSlug))
    .limit(1)
    .then((rows) => rows[0])
  // One answer for missing and not open to this domain, so keys can't be
  // probed.
  if (!workspace || !domain || workspace.joinDomain !== domain) {
    return c.json(
      { success: false, message: "Workspace not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const joined = await db.transaction((tx) =>
    addWorkspaceMember(tx, workspace.id, user.id)
  )
  if (joined) {
    afterWorkspaceJoin(workspace.id)
    await publishRealtime((io) =>
      io.to(workspaceRoom(workspace.id)).emit("workspace:member:joined", {
        workspaceId: workspace.id,
        userId: user.id,
        name: user.name,
        image: user.image ?? null,
      })
    ).catch((err) =>
      logger.warn(
        { err, workspaceId: workspace.id },
        "member:joined emit failed"
      )
    )
  }

  return c.json(
    {
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
      },
      firstChannelId: await firstTextChannelId(workspace.id),
    },
    HttpStatusCodes.OK
  )
}

export const completeWorkspaceSetup: AppRouteHandler<
  CompleteWorkspaceSetupRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, {
    connector: ["manage"],
  })

  const workspace = c.var.workspace
  let setupCompletedAt = workspace.setupCompletedAt
  if (!setupCompletedAt) {
    setupCompletedAt = new Date()
    await db
      .update(schema.workspace)
      .set({ setupCompletedAt })
      .where(eq(schema.workspace.id, workspace.id))
  }

  return c.json(
    {
      success: true as const,
      setupCompletedAt: setupCompletedAt.toISOString(),
    },
    HttpStatusCodes.OK
  )
}

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

  const updates: Partial<typeof schema.workspace.$inferInsert> = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.logo !== undefined) updates.logo = body.logo
  if (body.description !== undefined) {
    updates.description = body.description || null
  }
  if (body.website !== undefined) updates.website = websiteValue(body.website)
  if (body.joinDomain !== undefined) {
    // Only the caller's own verified company domain, so nobody can open a
    // workspace to a domain they don't belong to.
    const joinDomain =
      body.joinDomain === null ? null : normalizeDomain(body.joinDomain)
    if (
      body.joinDomain !== null &&
      (!joinDomain || joinDomain !== verifiedCompanyDomain(c.var.user))
    ) {
      throw new HTTPException(HttpStatusCodes.BAD_REQUEST, {
        message: "You can only open the workspace to your own email domain",
      })
    }
    updates.joinDomain = joinDomain
  }

  if (Object.keys(updates).length === 0) {
    return c.json(
      {
        success: true as const,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          logo: workspace.logo,
          description: workspace.description,
          website: workspace.website,
          joinDomain: workspace.joinDomain,
        },
      },
      HttpStatusCodes.OK
    )
  }

  const [updated] = await db
    .update(schema.workspace)
    .set(updates)
    .where(eq(schema.workspace.id, workspace.id))
    .returning(workspaceSummaryColumns)

  if (!updated) {
    return c.json(
      { success: false, message: "Workspace not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  return c.json(
    { success: true as const, workspace: updated },
    HttpStatusCodes.OK
  )
}

// ── Search ──────────────────────────────────────────────

const SESSION_SEARCH_LIMIT = 5

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
          inArray(schema.channel.type, ["text", "voice"])
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
    sessions: [],
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
    ilike(schema.message.content, searchPattern),
    // Voice channels contribute session chats: never the placeholder root,
    // and a live session's chat only for people in the call.
    ne(schema.message.type, "voice_session"),
    visibleToSessionChatFilter(currentUser.id, schema.message.threadRootId)
  )

  const [countResult, messages, sessions] = await Promise.all([
    db.select({ total: count() }).from(schema.message).where(whereConditions),
    db
      .select({
        id: schema.message.id,
        content: schema.message.content,
        createdAt: schema.message.createdAt,
        channelId: schema.message.channelId,
        threadRootId: schema.message.threadRootId,
        sessionId: schema.agentSession.id,
        sessionTitle: schema.agentSession.title,
        author: {
          id: schema.user.id,
          name: schema.user.name,
          image: schema.user.image,
        },
      })
      .from(schema.message)
      .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
      .leftJoin(
        schema.agentSession,
        eq(schema.agentSession.threadRootId, schema.message.threadRootId)
      )
      .where(whereConditions)
      .orderBy(desc(schema.message.createdAt))
      .limit(perPage)
      .offset(offset),
    // Archived sessions stay findable by title (workspace-model.md).
    page === 1
      ? db
          .select({
            id: schema.agentSession.id,
            title: schema.agentSession.title,
            channelId: schema.agentSession.channelId,
            archivedAt: schema.agentSession.archivedAt,
            lastActivityAt: schema.agentSession.lastActivityAt,
          })
          .from(schema.agentSession)
          .where(
            and(
              inArray(schema.agentSession.channelId, searchChannelIds),
              ilike(schema.agentSession.title, searchPattern)
            )
          )
          .orderBy(desc(schema.agentSession.lastActivityAt))
          .limit(SESSION_SEARCH_LIMIT)
      : Promise.resolve([]),
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
        sessionId: msg.sessionId,
        sessionTitle: msg.sessionTitle,
        author: {
          id: msg.author.id,
          name: msg.author.name,
          image: msg.author.image,
          avatarColor: avatarColorByUserId.get(msg.author.id) ?? null,
        },
        mentions: (mentionsByMessageId.get(msg.id) ?? []).map((mention) => ({
          id: mention.id,
          name: mention.name,
          image: mention.image,
          avatarColor: avatarColorByUserId.get(mention.id) ?? null,
        })),
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        channelId: session.channelId,
        channelName: channelMap.get(session.channelId) ?? "unknown",
        archived: session.archivedAt !== null,
        lastActivityAt: session.lastActivityAt.toISOString(),
      })),
    },
    HttpStatusCodes.OK
  )
}
