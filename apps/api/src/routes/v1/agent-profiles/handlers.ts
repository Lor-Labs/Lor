import { db } from "@repo/db"
import { agentProfile, integrationConnection } from "@repo/db/schema"
import { and, asc, desc, eq } from "drizzle-orm"
import { availableCapabilities } from "@/lib/agent-capabilities"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspacePermission } from "@/lib/permissions"
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
  grantsAll: agentProfile.grantsAll,
  capabilities: agentProfile.capabilities,
}

// Make sure the workspace has its permissive default profile (grants all,
// including future capabilities). onConflictDoNothing trips the one-default-per-
// workspace partial unique index, so concurrent calls are safe.
async function ensureDefaultProfile(workspaceId: string): Promise<void> {
  await db
    .insert(agentProfile)
    .values({ workspaceId, name: "Default", isDefault: true, grantsAll: true })
    .onConflictDoNothing()
}

export const listAgentProfiles: AppRouteHandler<
  ListAgentProfilesRoute
> = async (c) => {
  const workspace = c.var.workspace
  await ensureDefaultProfile(workspace.id)

  const profiles = await db
    .select(profileColumns)
    .from(agentProfile)
    .where(eq(agentProfile.workspaceId, workspace.id))
    .orderBy(desc(agentProfile.isDefault), asc(agentProfile.name))

  const connections = await db
    .select({ provider: integrationConnection.provider })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.workspaceId, workspace.id),
        eq(integrationConnection.status, "active")
      )
    )
  const connected = new Set<string>(connections.map((r) => r.provider))

  return c.json(
    { profiles, availableCapabilities: availableCapabilities(connected) },
    HttpStatusCodes.OK
  )
}

export const createAgentProfile: AppRouteHandler<
  CreateAgentProfileRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { name, capabilities } = c.req.valid("json")

  const created = await db
    .insert(agentProfile)
    .values({
      workspaceId: workspace.id,
      name,
      capabilities,
      grantsAll: false,
      isDefault: false,
    })
    .returning(profileColumns)
    .then((r) => r[0])

  if (!created) {
    return c.json(
      { success: false, message: "Failed to create profile" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }
  return c.json(created, HttpStatusCodes.OK)
}

export const updateAgentProfile: AppRouteHandler<
  UpdateAgentProfileRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { profileId } = c.req.valid("param")
  const { name, capabilities } = c.req.valid("json")

  const updated = await db
    .update(agentProfile)
    .set({
      ...(name !== undefined ? { name } : {}),
      // Tuning the granted set makes it an explicit allowlist (even the default
      // stops meaning "everything" once edited).
      ...(capabilities !== undefined ? { capabilities, grantsAll: false } : {}),
    })
    .where(
      and(
        eq(agentProfile.id, profileId),
        eq(agentProfile.workspaceId, workspace.id)
      )
    )
    .returning(profileColumns)
    .then((r) => r[0])

  if (!updated) {
    return c.json(
      { success: false, message: "Profile not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json(updated, HttpStatusCodes.OK)
}

export const deleteAgentProfile: AppRouteHandler<
  DeleteAgentProfileRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
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
