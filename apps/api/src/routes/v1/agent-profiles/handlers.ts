import {
  availableCapabilities,
  type CapabilityDescriptor,
  CONNECTORS,
} from "@repo/connectors"
import { db } from "@repo/db"
import {
  agentProfile,
  agentProfileCustomTool,
  agentProfileToolServer,
  customTool,
  integrationConnection,
  type MerlinCapability,
  toolServer,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
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

// profileId → explicitly granted tool server ids.
async function serverGrantsByProfile(
  profileIds: string[]
): Promise<Map<string, string[]>> {
  const grants = new Map<string, string[]>()
  if (profileIds.length === 0) return grants
  const rows = await db
    .select({
      profileId: agentProfileToolServer.profileId,
      toolServerId: agentProfileToolServer.toolServerId,
    })
    .from(agentProfileToolServer)
    .where(inArray(agentProfileToolServer.profileId, profileIds))
  for (const row of rows) {
    const list = grants.get(row.profileId)
    if (list) list.push(row.toolServerId)
    else grants.set(row.profileId, [row.toolServerId])
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

async function invalidServerIds(
  workspaceId: string,
  serverIds: string[]
): Promise<string[]> {
  if (serverIds.length === 0) return []
  const rows = await db
    .select({ id: toolServer.id })
    .from(toolServer)
    .where(
      and(
        eq(toolServer.workspaceId, workspaceId),
        inArray(toolServer.id, serverIds)
      )
    )
  const known = new Set(rows.map((r) => r.id))
  return serverIds.filter((id) => !known.has(id))
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

// Built-in capabilities are connection-less but still need their backing
// service configured server-side; hide web from the editor (and grant
// validation) when the deployment has no Exa key.
function configuredCapabilities(
  caps: CapabilityDescriptor[]
): CapabilityDescriptor[] {
  return caps.filter((c) => c.key !== "web" || Boolean(env.EXA_API_KEY))
}

// Capabilities the workspace can actually grant given its active connectors —
// the same set surfaced in the editor. Used to reject grants for disconnected
// providers before they're persisted.
async function grantableCapabilities(
  workspaceId: string
): Promise<Set<MerlinCapability>> {
  const connections = await db
    .select({ provider: integrationConnection.provider })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.workspaceId, workspaceId),
        eq(integrationConnection.status, "active")
      )
    )
  const connected = new Set(connections.map((r) => r.provider))
  return new Set(
    configuredCapabilities(availableCapabilities(connected)).map((c) => c.key)
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
  const [grants, serverGrants, connections, tools, servers] = await Promise.all(
    [
      toolGrantsByProfile(profileIds),
      serverGrantsByProfile(profileIds),
      db
        .select({ provider: integrationConnection.provider })
        .from(integrationConnection)
        .where(
          and(
            eq(integrationConnection.workspaceId, workspace.id),
            eq(integrationConnection.status, "active")
          )
        ),
      db
        .select({
          id: customTool.id,
          name: customTool.name,
          description: customTool.description,
        })
        .from(customTool)
        .where(eq(customTool.workspaceId, workspace.id))
        .orderBy(asc(customTool.name)),
      db
        .select({
          id: toolServer.id,
          name: toolServer.name,
          description: toolServer.description,
          enabledTools: toolServer.enabledTools,
        })
        .from(toolServer)
        .where(eq(toolServer.workspaceId, workspace.id))
        .orderBy(asc(toolServer.name)),
    ]
  )

  const connected = new Set(connections.map((r) => r.provider))
  const caps = configuredCapabilities(availableCapabilities(connected)).map(
    (c) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      connector: c.connector,
      connectorLabel: c.connector ? CONNECTORS[c.connector].label : c.label,
    })
  )

  return c.json(
    {
      profiles: profiles.map((p) => ({
        ...p,
        customToolIds: grants.get(p.id) ?? [],
        toolServerIds: serverGrants.get(p.id) ?? [],
      })),
      availableCapabilities: caps,
      availableCustomTools: tools,
      availableToolServers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        enabledToolCount: s.enabledTools.length,
      })),
    },
    HttpStatusCodes.OK
  )
}

export const createAgentProfile: AppRouteHandler<
  CreateAgentProfileRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { name, capabilities } = c.req.valid("json")
  const body = c.req.valid("json")
  // The join tables key on (profileId, toolId) — a duplicated id in the
  // request would otherwise fail the whole insert transaction.
  const customToolIds = [...new Set(body.customToolIds)]
  const toolServerIds = [...new Set(body.toolServerIds)]

  const grantable = await grantableCapabilities(workspace.id)
  const unsupported = capabilities.filter((k) => !grantable.has(k))
  if (unsupported.length > 0) {
    return c.json(
      {
        success: false,
        message: `Capabilities require a connected provider: ${unsupported.join(", ")}`,
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
  const unknownServers = await invalidServerIds(workspace.id, toolServerIds)
  if (unknownServers.length > 0) {
    return c.json(
      { success: false, message: "Unknown tool server ids" },
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
    if (toolServerIds.length > 0) {
      await tx.insert(agentProfileToolServer).values(
        toolServerIds.map((toolServerId) => ({
          profileId: row.id,
          toolServerId,
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
  return c.json(
    { ...created, customToolIds, toolServerIds },
    HttpStatusCodes.OK
  )
}

export const updateAgentProfile: AppRouteHandler<
  UpdateAgentProfileRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { profileId } = c.req.valid("param")
  const { name, capabilities } = c.req.valid("json")
  const body = c.req.valid("json")
  // Same dedupe as create — the join tables' composite keys reject duplicates.
  const customToolIds = body.customToolIds && [...new Set(body.customToolIds)]
  const toolServerIds = body.toolServerIds && [...new Set(body.toolServerIds)]

  if (capabilities !== undefined) {
    const grantable = await grantableCapabilities(workspace.id)
    const unsupported = capabilities.filter((k) => !grantable.has(k))
    if (unsupported.length > 0) {
      return c.json(
        {
          success: false,
          message: `Capabilities require a connected provider: ${unsupported.join(", ")}`,
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
  if (toolServerIds !== undefined) {
    const unknownServers = await invalidServerIds(workspace.id, toolServerIds)
    if (unknownServers.length > 0) {
      return c.json(
        { success: false, message: "Unknown tool server ids" },
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
    if (toolServerIds !== undefined) {
      await tx
        .delete(agentProfileToolServer)
        .where(eq(agentProfileToolServer.profileId, row.id))
      if (toolServerIds.length > 0) {
        await tx.insert(agentProfileToolServer).values(
          toolServerIds.map((toolServerId) => ({
            profileId: row.id,
            toolServerId,
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
  const servers =
    toolServerIds ?? (await serverGrantsByProfile([updated.id])).get(updated.id)
  return c.json(
    {
      ...updated,
      customToolIds: grants ?? [],
      toolServerIds: servers ?? [],
    },
    HttpStatusCodes.OK
  )
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
