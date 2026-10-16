import { db } from "@repo/db"
import { agentProfile, profileToolAccessSchema } from "@repo/db/schema"
import { and, asc, desc, eq } from "drizzle-orm"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspaceAuthority } from "@/lib/permissions"
import {
  profileToolAccessIssue,
  workspaceProfileToolGroups,
} from "@/lib/profile-tool-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  CreateAgentProfileRoute,
  DeleteAgentProfileRoute,
  ListAgentProfilesRoute,
  UpdateAgentProfileRoute,
} from "@/routes/v1/agent-profiles/routes"

const profileColumns = {
  id: agentProfile.id,
  name: agentProfile.name,
  isDefault: agentProfile.isDefault,
  toolAccess: agentProfile.toolAccess,
}

// Parsing fills defaults (e.g. `builtins: {}`) so clients always get the full shape.
const toResponse = <T extends { toolAccess: unknown }>(row: T) => ({
  ...row,
  toolAccess: profileToolAccessSchema.parse(row.toolAccess),
})

// Make sure the workspace has its default profile. An empty toolAccess follows
// the workspace for every tool source. onConflictDoNothing trips the
// one-default-per-workspace partial unique index, so concurrent calls are safe.
async function ensureDefaultProfile(workspaceId: string): Promise<void> {
  await db
    .insert(agentProfile)
    .values({ workspaceId, name: "Default", isDefault: true })
    .onConflictDoNothing()
}

export const listAgentProfiles: AppRouteHandler<
  ListAgentProfilesRoute
> = async (c) => {
  const workspace = c.var.workspace
  await ensureDefaultProfile(workspace.id)

  const [profiles, groups] = await Promise.all([
    db
      .select(profileColumns)
      .from(agentProfile)
      .where(eq(agentProfile.workspaceId, workspace.id))
      .orderBy(desc(agentProfile.isDefault), asc(agentProfile.name)),
    workspaceProfileToolGroups(workspace.id),
  ])

  return c.json(
    {
      profiles: profiles.map(toResponse),
      availableToolGroups: groups,
    },
    HttpStatusCodes.OK
  )
}

export const createAgentProfile: AppRouteHandler<
  CreateAgentProfileRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { agentProfile: ["manage"] })
  const body = c.req.valid("json")
  const issue = await profileToolAccessIssue(workspace.id, body.toolAccess)
  if (issue)
    return c.json(
      { success: false, message: issue },
      HttpStatusCodes.BAD_REQUEST
    )

  const created = await db
    .insert(agentProfile)
    .values({
      workspaceId: workspace.id,
      name: body.name,
      toolAccess: body.toolAccess,
      isDefault: false,
    })
    .returning(profileColumns)
    .then((rows) => rows[0])

  if (!created) {
    return c.json(
      { success: false, message: "Failed to create profile" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }
  return c.json(toResponse(created), HttpStatusCodes.OK)
}

export const updateAgentProfile: AppRouteHandler<
  UpdateAgentProfileRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { agentProfile: ["manage"] })
  const { profileId } = c.req.valid("param")
  const body = c.req.valid("json")
  if (body.toolAccess !== undefined) {
    const issue = await profileToolAccessIssue(workspace.id, body.toolAccess)
    if (issue)
      return c.json(
        { success: false, message: issue },
        HttpStatusCodes.BAD_REQUEST
      )
  }

  const updated = await db
    .update(agentProfile)
    .set({
      ...(body.toolAccess !== undefined ? { toolAccess: body.toolAccess } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
    })
    .where(
      and(
        eq(agentProfile.id, profileId),
        eq(agentProfile.workspaceId, workspace.id)
      )
    )
    .returning(profileColumns)
    .then((rows) => rows[0])

  if (!updated) {
    return c.json(
      { success: false, message: "Profile not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json(toResponse(updated), HttpStatusCodes.OK)
}

export const deleteAgentProfile: AppRouteHandler<
  DeleteAgentProfileRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { agentProfile: ["manage"] })
  const { profileId } = c.req.valid("param")

  const profile = await db
    .select({ isDefault: agentProfile.isDefault })
    .from(agentProfile)
    .where(
      and(
        eq(agentProfile.id, profileId),
        eq(agentProfile.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((r) => r[0])

  if (!profile) {
    return c.json(
      { success: false, message: "Profile not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (profile.isDefault) {
    return c.json(
      { success: false, message: "The default profile can't be deleted" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Channels referencing it fall back to the default (FK on delete: set null).
  await db.delete(agentProfile).where(eq(agentProfile.id, profileId))
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
