import {
  availableCapabilities,
  type CapabilityDescriptor,
  CONNECTORS,
} from "@repo/connectors"
import { db } from "@repo/db"
import {
  agentProfile,
  agentProfileCustomTool,
  customTool,
  type LorCapability,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
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
  grantsAll: agentProfile.grantsAll,
  capabilities: agentProfile.capabilities,
  toolAccess: agentProfile.toolAccess,
}

// profileId → explicitly granted tool ids (agent_profile_custom_tool rows).
async function toolGrantsByProfile(
  profileIds: string[]
): Promise<Map<string, string[]>> {
  const grants = new Map<string, string[]>()
  if (profileIds.length === 0) return grants
  const rows = await db
    .select({
      profileId: agentProfileCustomTool.profileId,
      customToolId: agentProfileCustomTool.customToolId,
    })
    .from(agentProfileCustomTool)
    .where(inArray(agentProfileCustomTool.profileId, profileIds))
  for (const row of rows) {
    const list = grants.get(row.profileId)
    if (list) list.push(row.customToolId)
    else grants.set(row.profileId, [row.customToolId])
  }
  return grants
}

// Grants may only reference this workspace's tools — the FK alone can't stop
// cross-workspace ids.
async function invalidToolIds(
  workspaceId: string,
  toolIds: string[]
): Promise<string[]> {
  if (toolIds.length === 0) return []
  const rows = await db
    .select({ id: customTool.id })
    .from(customTool)
    .where(
      and(
        eq(customTool.workspaceId, workspaceId),
        inArray(customTool.id, toolIds)
      )
    )
  const known = new Set(rows.map((r) => r.id))
  return toolIds.filter((id) => !known.has(id))
}

// Make sure the workspace has its default profile. Its connector/MCP access
// follows workspace tools unless overridden. onConflictDoNothing trips the one-default-per-
// workspace partial unique index, so concurrent calls are safe.
async function ensureDefaultProfile(workspaceId: string): Promise<void> {
  await db
    .insert(agentProfile)
    .values({ workspaceId, name: "Default", isDefault: true, grantsAll: true })
    .onConflictDoNothing()
}

// Built-in capabilities are connection-less but still need their backing
// service configured server-side; hide web from the editor (and grant
// validation) when the deployment has no Exa key.
function configuredCapabilities(
  caps: CapabilityDescriptor[]
): CapabilityDescriptor[] {
  return caps.filter(
    (c) => c.connector === null && (c.key !== "web" || Boolean(env.EXA_API_KEY))
  )
}

// Standalone grant groups only. Connector/MCP access is validated by toolAccess.
function grantableCapabilities(): Set<LorCapability> {
  return new Set(
    configuredCapabilities(availableCapabilities()).map((c) => c.key)
  )
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
  const profileIds = profiles.map((p) => p.id)
  const [grants, tools] = await Promise.all([
    toolGrantsByProfile(profileIds),
    db
      .select({
        id: customTool.id,
        name: customTool.name,
        description: customTool.description,
      })
      .from(customTool)
      .where(eq(customTool.workspaceId, workspace.id))
      .orderBy(asc(customTool.name)),
  ])

  const caps = configuredCapabilities(availableCapabilities()).map((c) => ({
    key: c.key,
    label: c.label,
    description: c.description,
    connector: c.connector,
    connectorLabel: c.connector ? CONNECTORS[c.connector].label : c.label,
  }))

  return c.json(
    {
      profiles: profiles.map((p) => ({
        ...p,
        customToolIds: grants.get(p.id) ?? [],
      })),
      availableCapabilities: caps,
      availableToolGroups: await workspaceProfileToolGroups(workspace.id),
      availableCustomTools: tools,
    },
    HttpStatusCodes.OK
  )
}

export const createAgentProfile: AppRouteHandler<
  CreateAgentProfileRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { agentProfile: ["manage"] })
  const { name, capabilities } = c.req.valid("json")
  const body = c.req.valid("json")
  if (body.toolAccess !== undefined) {
    const issue = await profileToolAccessIssue(workspace.id, body.toolAccess)
    if (issue)
      return c.json(
        { success: false, message: issue },
        HttpStatusCodes.BAD_REQUEST
      )
  }

  // The join tables key on (profileId, toolId) — a duplicated id in the
  // request would otherwise fail the whole insert transaction.
  const customToolIds = [...new Set(body.customToolIds)]

  const grantable = grantableCapabilities()
  const unsupported = capabilities.filter((k) => !grantable.has(k))
  if (unsupported.length > 0) {
    return c.json(
      {
        success: false,
        message: `Configure connector tools through toolAccess; unavailable standalone capabilities: ${unsupported.join(", ")}`,
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const unknownTools = await invalidToolIds(workspace.id, customToolIds)
  if (unknownTools.length > 0) {
    return c.json(
      { success: false, message: "Unknown custom tool ids" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const created = await db.transaction(async (tx) => {
    const row = await tx
      .insert(agentProfile)
      .values({
        workspaceId: workspace.id,
        name,
        capabilities,
        toolAccess: body.toolAccess,
        grantsAll: false,
        isDefault: false,
      })
      .returning(profileColumns)
      .then((r) => r[0])
    if (!row) return null
    if (customToolIds.length > 0) {
      await tx.insert(agentProfileCustomTool).values(
        customToolIds.map((customToolId) => ({
          profileId: row.id,
          customToolId,
        }))
      )
    }
    return row
  })

  if (!created) {
    return c.json(
      { success: false, message: "Failed to create profile" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }
  return c.json({ ...created, customToolIds }, HttpStatusCodes.OK)
}

export const updateAgentProfile: AppRouteHandler<
  UpdateAgentProfileRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { agentProfile: ["manage"] })
  const { profileId } = c.req.valid("param")
  const { name, capabilities } = c.req.valid("json")
  const body = c.req.valid("json")
  if (body.toolAccess !== undefined) {
    const issue = await profileToolAccessIssue(workspace.id, body.toolAccess)
    if (issue)
      return c.json(
        { success: false, message: issue },
        HttpStatusCodes.BAD_REQUEST
      )
  }

  // Same dedupe as create — the join tables' composite keys reject duplicates.
  const customToolIds = body.customToolIds && [...new Set(body.customToolIds)]

  if (capabilities !== undefined) {
    const grantable = grantableCapabilities()
    const unsupported = capabilities.filter((k) => !grantable.has(k))
    if (unsupported.length > 0) {
      return c.json(
        {
          success: false,
          message: `Configure connector tools through toolAccess; unavailable standalone capabilities: ${unsupported.join(", ")}`,
        },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }
  if (customToolIds !== undefined) {
    const unknownTools = await invalidToolIds(workspace.id, customToolIds)
    if (unknownTools.length > 0) {
      return c.json(
        { success: false, message: "Unknown custom tool ids" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

  const updated = await db.transaction(async (tx) => {
    const row = await tx
      .update(agentProfile)
      .set({
        // Always-set so a customToolIds-only patch isn't an empty `.set({})`
        // (drizzle throws) — and grant changes are profile updates anyway.
        updatedAt: new Date(),
        ...(body.toolAccess !== undefined
          ? { toolAccess: body.toolAccess }
          : {}),
        ...(name !== undefined ? { name } : {}),
        // Tuning the granted set makes it an explicit allowlist (even the default
        // stops meaning "everything" once edited).
        ...(capabilities !== undefined
          ? { capabilities, grantsAll: false }
          : {}),
      })
      .where(
        and(
          eq(agentProfile.id, profileId),
          eq(agentProfile.workspaceId, workspace.id)
        )
      )
      .returning(profileColumns)
      .then((r) => r[0])
    if (!row) return null
    if (customToolIds !== undefined) {
      // Replace-not-diff: grant rows carry no metadata (yet), so a wholesale
      // rewrite is simplest and the set is small.
      await tx
        .delete(agentProfileCustomTool)
        .where(eq(agentProfileCustomTool.profileId, row.id))
      if (customToolIds.length > 0) {
        await tx.insert(agentProfileCustomTool).values(
          customToolIds.map((customToolId) => ({
            profileId: row.id,
            customToolId,
          }))
        )
      }
    }
    return row
  })

  if (!updated) {
    return c.json(
      { success: false, message: "Profile not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const grants =
    customToolIds ?? (await toolGrantsByProfile([updated.id])).get(updated.id)
  return c.json(
    {
      ...updated,
      customToolIds: grants ?? [],
    },
    HttpStatusCodes.OK
  )
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
