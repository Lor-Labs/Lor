import type { WorkspaceAuthority } from "@repo/auth/permissions"
import { and, asc, db, eq, inArray, isNull, max, or, schema } from "@repo/db"
import {
  listChannelAudienceUserIds,
  resolveChannelAccess,
} from "@repo/db/queries/channel-access"
import type { ProjectUpdatedEvent } from "@repo/realtime-types/events"
import { userRoom } from "@repo/realtime-types/rooms"
import { getEmitter } from "@/lib/bot-messages"
import { postChannelEvent } from "@/lib/channel-events"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { completeLoopsForChannels } from "@/lib/loops"
import { hasWorkspaceAuthority } from "@/lib/permissions"
import { enqueueProjectArchive } from "@/lib/project-archive-queue"
import { disconnectUserSockets } from "@/lib/socket-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  AddProjectMemberRoute,
  ArchiveProjectRoute,
  CreateProjectRoute,
  GetProjectRoute,
  ListProjectsRoute,
  RemoveProjectMemberRoute,
  UpdateProjectRoute,
} from "@/routes/v1/projects/routes"

// Project membership lives on the category channel (the access container) —
// the same channel_member rows the shared resolver checks.

// Membership changes are per-project but visible per-channel, so the event row
// lands in every active text channel of the project.
async function postMemberEventToProjectChannels(input: {
  categoryChannelId: string
  actorId: string
  event:
    | { eventType: "member_added"; payload: { userIds: string[] } }
    | { eventType: "member_removed"; payload: { userId: string } }
    | { eventType: "member_left" }
}) {
  const children = await db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      name: schema.channel.name,
    })
    .from(schema.channel)
    .where(
      and(
        eq(schema.channel.parentId, input.categoryChannelId),
        eq(schema.channel.type, "text"),
        isNull(schema.channel.archivedAt)
      )
    )
  for (const channel of children) {
    await postChannelEvent({
      channel,
      actorId: input.actorId,
      ...input.event,
    })
  }
}

type ProjectRow = typeof schema.project.$inferSelect

function serializeProject(
  row: ProjectRow,
  category: { name: string | null; audience: "workspace" | "members" }
) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    categoryChannelId: row.categoryChannelId,
    creatorId: row.creatorId,
    name: category.name ?? "",
    description: row.description,
    targetDate: row.targetDate?.toISOString() ?? null,
    audience: category.audience,
    status: row.status,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

async function loadProjectDetail(projectId: string) {
  const row = await db
    .select({
      project: schema.project,
      categoryName: schema.channel.name,
      categoryAudience: schema.channel.audience,
    })
    .from(schema.project)
    .innerJoin(
      schema.channel,
      eq(schema.project.categoryChannelId, schema.channel.id)
    )
    .where(eq(schema.project.id, projectId))
    .limit(1)
    .then((rows) => rows[0])
  if (!row) return null

  const [members, channels] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        image: schema.user.image,
      })
      .from(schema.channelMember)
      .innerJoin(schema.user, eq(schema.channelMember.userId, schema.user.id))
      .where(eq(schema.channelMember.channelId, row.project.categoryChannelId))
      .orderBy(asc(schema.user.name)),
    db
      .select({
        id: schema.channel.id,
        name: schema.channel.name,
        type: schema.channel.type,
        archivedAt: schema.channel.archivedAt,
      })
      .from(schema.channel)
      .where(eq(schema.channel.parentId, row.project.categoryChannelId))
      .orderBy(asc(schema.channel.position)),
  ])

  return {
    ...serializeProject(row.project, {
      name: row.categoryName,
      audience: row.categoryAudience,
    }),
    summary: row.project.summary,
    memories: row.project.archiveMemories ?? [],
    members,
    channels: channels.flatMap((ch) =>
      ch.type === "text" || ch.type === "voice"
        ? [
            {
              id: ch.id,
              name: ch.name,
              type: ch.type,
              archivedAt: ch.archivedAt?.toISOString() ?? null,
            },
          ]
        : []
    ),
  }
}

// Project management: the creator, plus workspace admins/owner. Membership on
// private projects is NOT checked here — callers gate visibility first via
// loadAccessibleProject (resolveChannelAccess), which blocks invisible admins.
function canManageProject(
  project: Pick<ProjectRow, "creatorId">,
  actor: { userId: string },
  authority: WorkspaceAuthority
) {
  if (project.creatorId === actor.userId) return true
  return hasWorkspaceAuthority(authority, { channel: ["update"] })
}

export const listProjects: AppRouteHandler<ListProjectsRoute> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user

  const rows = await db
    .select({
      project: schema.project,
      categoryName: schema.channel.name,
      categoryAudience: schema.channel.audience,
    })
    .from(schema.project)
    .innerJoin(
      schema.channel,
      eq(schema.project.categoryChannelId, schema.channel.id)
    )
    .where(eq(schema.project.workspaceId, workspace.id))
    .orderBy(asc(schema.project.createdAt))

  const privateCategoryIds = rows
    .filter((row) => row.categoryAudience === "members")
    .map((row) => row.project.categoryChannelId)
  const membershipRows = privateCategoryIds.length
    ? await db
        .select({ channelId: schema.channelMember.channelId })
        .from(schema.channelMember)
        .where(
          and(
            eq(schema.channelMember.userId, currentUser.id),
            inArray(schema.channelMember.channelId, privateCategoryIds)
          )
        )
    : []
  const memberOf = new Set(membershipRows.map((row) => row.channelId))

  const projects = rows
    .filter(
      (row) =>
        row.categoryAudience === "workspace" ||
        memberOf.has(row.project.categoryChannelId)
    )
    .map((row) =>
      serializeProject(row.project, {
        name: row.categoryName,
        audience: row.categoryAudience,
      })
    )

  return c.json({ projects }, HttpStatusCodes.OK)
}

export const createProject: AppRouteHandler<CreateProjectRoute> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const body = c.req.valid("json")

  // Same gate as channel creation — projects are channel groups.
  if (
    !hasWorkspaceAuthority(c.var.authority, {
      channel: ["create"],
    })
  ) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  // Members must belong to this workspace; the creator is always a member.
  const memberIds = [...new Set([currentUser.id, ...body.memberIds])]
  const workspaceMemberRows = await db
    .select({ userId: schema.workspaceMember.userId })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspace.id),
        inArray(schema.workspaceMember.userId, memberIds)
      )
    )
  if (workspaceMemberRows.length !== memberIds.length) {
    return c.json(
      {
        success: false,
        message: "All project members must belong to this workspace",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const projectId = await db.transaction(async (tx) => {
    const nextPosition = await tx
      .select({ value: max(schema.channel.position) })
      .from(schema.channel)
      .where(
        and(
          eq(schema.channel.workspaceId, workspace.id),
          eq(schema.channel.type, "category")
        )
      )
      .then((rows) => (rows[0]?.value ?? 0) + 1)

    const category = await tx
      .insert(schema.channel)
      .values({
        workspaceId: workspace.id,
        type: "category",
        name: body.name,
        audience: body.audience,
        position: nextPosition,
        creatorId: currentUser.id,
      })
      .returning({ id: schema.channel.id })
      .then((rows) => rows[0])
    if (!category) throw new Error("Category insert returned no row")

    await tx.insert(schema.channel).values(
      body.channels.map((ch, index) => ({
        workspaceId: workspace.id,
        parentId: category.id,
        type: ch.type,
        name: ch.name,
        // Mirrors the container's audience for consistency in raw queries;
        // resolution inherits from the container regardless.
        audience: body.audience,
        position: index,
        creatorId: currentUser.id,
      }))
    )

    // Membership rows live on the category for both audiences — the roster
    // for public projects, also the access list for private ones.
    await tx.insert(schema.channelMember).values(
      memberIds.map((userId) => ({
        channelId: category.id,
        userId,
      }))
    )

    const inserted = await tx
      .insert(schema.project)
      .values({
        workspaceId: workspace.id,
        categoryChannelId: category.id,
        creatorId: currentUser.id,
        description: body.description ?? null,
        targetDate: body.targetDate ? new Date(body.targetDate) : null,
      })
      .returning({ id: schema.project.id })
      .then((rows) => rows[0])
    if (!inserted) throw new Error("Project insert returned no row")
    return inserted.id
  })

  const detail = await loadProjectDetail(projectId)
  if (!detail) {
    return c.json(
      { success: false, message: "Internal server error" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }
  return c.json(detail, HttpStatusCodes.CREATED)
}

// Loads the project and verifies the caller can see it. Null when missing OR
// hidden — indistinguishable.
async function loadAccessibleProject(
  projectId: string,
  workspaceId: string,
  userId: string
) {
  const row = await db
    .select()
    .from(schema.project)
    .where(
      and(
        eq(schema.project.id, projectId),
        eq(schema.project.workspaceId, workspaceId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!row) return null
  const access = await resolveChannelAccess(userId, row.categoryChannelId)
  if (!access.ok) return null
  return row
}

export const getProject: AppRouteHandler<GetProjectRoute> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { projectId } = c.req.valid("param")

  const project = await loadAccessibleProject(
    projectId,
    workspace.id,
    currentUser.id
  )
  if (!project) {
    return c.json(
      { success: false, message: "Project not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const detail = await loadProjectDetail(project.id)
  if (!detail) {
    return c.json(
      { success: false, message: "Project not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json(detail, HttpStatusCodes.OK)
}

export const updateProject: AppRouteHandler<UpdateProjectRoute> = async (c) => {
  const workspace = c.var.workspace
  const member = c.var.member
  const currentUser = c.var.user
  const { projectId } = c.req.valid("param")
  const body = c.req.valid("json")

  const project = await loadAccessibleProject(
    projectId,
    workspace.id,
    currentUser.id
  )
  if (!project) {
    return c.json(
      { success: false, message: "Project not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (!canManageProject(project, member, c.var.authority)) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  await db.transaction(async (tx) => {
    if (body.name !== undefined) {
      await tx
        .update(schema.channel)
        .set({ name: body.name })
        .where(eq(schema.channel.id, project.categoryChannelId))
    }
    const updates: Partial<typeof schema.project.$inferInsert> = {}
    if (body.description !== undefined) updates.description = body.description
    if (body.targetDate !== undefined) {
      updates.targetDate = body.targetDate ? new Date(body.targetDate) : null
    }
    if (Object.keys(updates).length > 0) {
      await tx
        .update(schema.project)
        .set(updates)
        .where(eq(schema.project.id, project.id))
    }
  })

  const detail = await loadProjectDetail(project.id)
  if (!detail) {
    return c.json(
      { success: false, message: "Project not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  await emitProjectUpdated({
    projectId: detail.id,
    categoryChannelId: detail.categoryChannelId,
    status: detail.status,
    archivedAt: detail.archivedAt,
  })
  return c.json(detail, HttpStatusCodes.OK)
}

// Best effort: tell every member's open clients the project changed so
// sidebars/composers react without a refetch cycle.
async function emitProjectUpdated(
  event: ProjectUpdatedEvent,
  extraUserIds: string[] = []
) {
  try {
    const [io, userIds] = await Promise.all([
      getEmitter(),
      listChannelAudienceUserIds(event.categoryChannelId),
    ])
    for (const userId of new Set([...userIds, ...extraUserIds])) {
      io.to(userRoom(userId)).emit("project:updated", event)
    }
  } catch (err) {
    logger.error(
      { err, projectId: event.projectId },
      "project:updated emit failed"
    )
  }
}

export const archiveProject: AppRouteHandler<ArchiveProjectRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const member = c.var.member
  const currentUser = c.var.user
  const { projectId } = c.req.valid("param")

  const project = await loadAccessibleProject(
    projectId,
    workspace.id,
    currentUser.id
  )
  if (!project) {
    return c.json(
      { success: false, message: "Project not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (!canManageProject(project, member, c.var.authority)) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  if (project.status !== "active") {
    return c.json(
      { success: false, message: "Project is already archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Locks first, synthesis after: archivedAt on the category + children makes
  // every write path reject immediately, so the worker summarizes a frozen
  // transcript.
  const archivedAt = new Date()
  // CAS on status: two concurrent archive requests can't both lock the
  // channels and enqueue — the loser bails below.
  const transitioned = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.project)
      .set({ status: "archiving", archivedAt })
      .where(
        and(
          eq(schema.project.id, project.id),
          eq(schema.project.status, "active")
        )
      )
      .returning({ id: schema.project.id })
    if (updated.length === 0) return false
    await tx
      .update(schema.channel)
      .set({ archivedAt })
      .where(
        and(
          or(
            eq(schema.channel.id, project.categoryChannelId),
            eq(schema.channel.parentId, project.categoryChannelId)
          ),
          isNull(schema.channel.archivedAt)
        )
      )
    return true
  })
  if (!transitioned) {
    return c.json(
      { success: false, message: "Project is already archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  try {
    await enqueueProjectArchive(project.id)
  } catch (err) {
    // No job means no synthesis and no completion — unwind the lock rather
    // than strand the project in "archiving".
    logger.error({ err, projectId: project.id }, "Archive enqueue failed")
    await db.transaction(async (tx) => {
      await tx
        .update(schema.project)
        .set({ status: "active", archivedAt: null })
        .where(eq(schema.project.id, project.id))
      await tx
        .update(schema.channel)
        .set({ archivedAt: null })
        .where(
          and(
            or(
              eq(schema.channel.id, project.categoryChannelId),
              eq(schema.channel.parentId, project.categoryChannelId)
            ),
            eq(schema.channel.archivedAt, archivedAt)
          )
        )
    })
    return c.json(
      { success: false, message: "Internal server error" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }

  const detail = await loadProjectDetail(project.id)
  if (!detail) {
    return c.json(
      { success: false, message: "Project not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // Loops can't outlive their project — archived channels refuse writes, so
  // leaving them active would just fail runs into auto-pause. Best effort:
  // the archive itself is already locked in.
  await completeLoopsForChannels(
    detail.channels.map((ch) => ch.id).concat(project.categoryChannelId),
    "Project archived"
  ).catch((err) => {
    logger.error({ err, projectId: project.id }, "Project loop sweep failed")
  })

  await emitProjectUpdated({
    projectId: project.id,
    categoryChannelId: project.categoryChannelId,
    status: "archiving",
    archivedAt: archivedAt.toISOString(),
  })
  return c.json(detail, HttpStatusCodes.OK)
}

export const addProjectMember: AppRouteHandler<AddProjectMemberRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const member = c.var.member
  const currentUser = c.var.user
  const { projectId } = c.req.valid("param")
  const { userId } = c.req.valid("json")

  const project = await loadAccessibleProject(
    projectId,
    workspace.id,
    currentUser.id
  )
  if (!project) {
    return c.json(
      { success: false, message: "Project not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (!canManageProject(project, member, c.var.authority)) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  if (project.status !== "active") {
    return c.json(
      { success: false, message: "Archived projects cannot be modified" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const isWorkspaceMember = await db
    .select({ userId: schema.workspaceMember.userId })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspace.id),
        eq(schema.workspaceMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!isWorkspaceMember) {
    return c.json(
      { success: false, message: "User is not a member of this workspace" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const insertedMember = await db
    .insert(schema.channelMember)
    .values({ channelId: project.categoryChannelId, userId })
    .onConflictDoNothing()
    .returning({ id: schema.channelMember.id })
    .then((rows) => rows[0])

  // onConflictDoNothing returns no row when the user was already a member —
  // no event for a no-op add.
  if (insertedMember) {
    await postMemberEventToProjectChannels({
      categoryChannelId: project.categoryChannelId,
      actorId: currentUser.id,
      event: { eventType: "member_added", payload: { userIds: [userId] } },
    })
  }

  await emitProjectUpdated({
    projectId: project.id,
    categoryChannelId: project.categoryChannelId,
    status: project.status,
    archivedAt: project.archivedAt?.toISOString() ?? null,
  })

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const removeProjectMember: AppRouteHandler<
  RemoveProjectMemberRoute
> = async (c) => {
  const workspace = c.var.workspace
  const member = c.var.member
  const currentUser = c.var.user
  const { projectId, userId } = c.req.valid("param")

  const project = await loadAccessibleProject(
    projectId,
    workspace.id,
    currentUser.id
  )
  if (!project) {
    return c.json(
      { success: false, message: "Project not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  // Anyone can remove themselves (leave); removing others needs management.
  if (
    userId !== currentUser.id &&
    !canManageProject(project, member, c.var.authority)
  ) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  if (project.status !== "active") {
    return c.json(
      { success: false, message: "Archived projects cannot be modified" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Never orphan a private project: the last member can't leave.
  const removed = await db.transaction(async (tx) => {
    const remaining = await tx
      .select({ userId: schema.channelMember.userId })
      .from(schema.channelMember)
      .where(eq(schema.channelMember.channelId, project.categoryChannelId))
      .for("update")
    const wasMember = remaining.some((row) => row.userId === userId)
    if (remaining.length <= 1 && wasMember) {
      return { ok: false as const }
    }
    await tx
      .delete(schema.channelMember)
      .where(
        and(
          eq(schema.channelMember.channelId, project.categoryChannelId),
          eq(schema.channelMember.userId, userId)
        )
      )
    return { ok: true as const, wasMember }
  })

  if (!removed.ok) {
    return c.json(
      { success: false, message: "A project must keep at least one member" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  if (!removed.wasMember) {
    return c.json({ success: true as const }, HttpStatusCodes.OK)
  }

  await disconnectUserSockets(userId)

  await postMemberEventToProjectChannels({
    categoryChannelId: project.categoryChannelId,
    actorId: currentUser.id,
    event:
      userId === currentUser.id
        ? { eventType: "member_left" }
        : { eventType: "member_removed", payload: { userId } },
  })

  // The removed user left the audience, so notify them explicitly too.
  await emitProjectUpdated(
    {
      projectId: project.id,
      categoryChannelId: project.categoryChannelId,
      status: project.status,
      archivedAt: project.archivedAt?.toISOString() ?? null,
    },
    [userId]
  )

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
