import { and, asc, db, eq, inArray, max, schema } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { hasWorkspacePermission } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  AddProjectMemberRoute,
  CreateProjectRoute,
  GetProjectRoute,
  ListProjectsRoute,
  RemoveProjectMemberRoute,
  UpdateProjectRoute,
} from "@/routes/v1/projects/routes"

// Project membership lives on the category channel (the access container) —
// the same channel_member rows the shared resolver checks.

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
        username: schema.user.username,
        displayUsername: schema.user.displayUsername,
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

// Project management: the creator, plus workspace admins/owner — who, for
// private projects, must also be members (no invisible admin access).
function canManageProject(
  project: Pick<ProjectRow, "creatorId">,
  actor: { userId: string; role: string },
  workspace: { ownerId: string }
) {
  if (project.creatorId === actor.userId) return true
  return hasWorkspacePermission(actor, workspace, { channel: ["update"] })
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
  const member = c.var.member
  const currentUser = c.var.user
  const body = c.req.valid("json")

  // Same gate as channel creation — projects are channel groups.
  if (
    !hasWorkspacePermission(member, workspace, {
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
  if (!canManageProject(project, member, workspace)) {
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
  if (!canManageProject(project, member, workspace)) {
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

  await db
    .insert(schema.channelMember)
    .values({ channelId: project.categoryChannelId, userId })
    .onConflictDoNothing()

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
    !canManageProject(project, member, workspace)
  ) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  // Never orphan a private project: the last member can't leave.
  const removed = await db.transaction(async (tx) => {
    const remaining = await tx
      .select({ userId: schema.channelMember.userId })
      .from(schema.channelMember)
      .where(eq(schema.channelMember.channelId, project.categoryChannelId))
      .for("update")
    if (
      remaining.length <= 1 &&
      remaining.some((row) => row.userId === userId)
    ) {
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
    return { ok: true as const }
  })

  if (!removed.ok) {
    return c.json(
      { success: false, message: "A project must keep at least one member" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
