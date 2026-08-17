import { and, db, eq, schema } from "@repo/db"
import { ALL_MERLIN_CAPABILITIES, type MerlinCapability } from "@repo/db/schema"

// What a channel's profile lets Merlin use: gated capabilities plus the
// workspace-tool grants. `customTools`/`toolServers` are "all" when the
// profile grants the blanket `custom_tools` capability (or grantsAll);
// otherwise the explicit per-profile grant lists (join-table rows).
export type ChannelToolGrants = {
  capabilities: MerlinCapability[]
  customTools: "all" | string[]
  toolServers: "all" | string[]
}

const PERMISSIVE_GRANTS: ChannelToolGrants = {
  capabilities: ALL_MERLIN_CAPABILITIES,
  customTools: "all",
  toolServers: "all",
}

async function profileGrants(profile: {
  id: string
  grantsAll: boolean
  capabilities: MerlinCapability[]
}): Promise<ChannelToolGrants> {
  if (profile.grantsAll) return PERMISSIVE_GRANTS
  if (profile.capabilities.includes("custom_tools")) {
    return {
      capabilities: profile.capabilities,
      customTools: "all",
      toolServers: "all",
    }
  }
  const [toolGrants, serverGrants] = await Promise.all([
    db
      .select({ customToolId: schema.agentProfileCustomTool.customToolId })
      .from(schema.agentProfileCustomTool)
      .where(eq(schema.agentProfileCustomTool.profileId, profile.id)),
    db
      .select({ toolServerId: schema.agentProfileToolServer.toolServerId })
      .from(schema.agentProfileToolServer)
      .where(eq(schema.agentProfileToolServer.profileId, profile.id)),
  ])
  return {
    capabilities: profile.capabilities,
    customTools: toolGrants.map((g) => g.customToolId),
    toolServers: serverGrants.map((g) => g.toolServerId),
  }
}

async function getProfile(id: string, workspaceId: string) {
  return db
    .select({
      id: schema.agentProfile.id,
      grantsAll: schema.agentProfile.grantsAll,
      capabilities: schema.agentProfile.capabilities,
    })
    .from(schema.agentProfile)
    .where(
      and(
        eq(schema.agentProfile.id, id),
        eq(schema.agentProfile.workspaceId, workspaceId)
      )
    )
    .limit(1)
    .then((r) => r[0] ?? null)
}

// Resolve which gated tools Merlin may use in a channel: explicit channel
// profile → parent category's profile → the workspace default → all (permissive
// fallback, so an un-provisioned workspace behaves exactly as before). The brain
// and chat search are core and never gated here.
export async function resolveChannelCapabilities(
  channelId: string
): Promise<ChannelToolGrants> {
  const ch = await db
    .select({
      agentProfileId: schema.channel.agentProfileId,
      parentId: schema.channel.parentId,
      workspaceId: schema.channel.workspaceId,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
    .limit(1)
    .then((r) => r[0] ?? null)
  if (!ch) return PERMISSIVE_GRANTS

  // 1. Explicit channel profile (scoped to the channel's workspace).
  if (ch.agentProfileId && ch.workspaceId) {
    const p = await getProfile(ch.agentProfileId, ch.workspaceId)
    if (p) return profileGrants(p)
  }
  // 2. Parent category's profile (the "group").
  if (ch.parentId && ch.workspaceId) {
    const parentProfileId = await db
      .select({ agentProfileId: schema.channel.agentProfileId })
      .from(schema.channel)
      .where(eq(schema.channel.id, ch.parentId))
      .limit(1)
      .then((r) => r[0]?.agentProfileId ?? null)
    if (parentProfileId) {
      const p = await getProfile(parentProfileId, ch.workspaceId)
      if (p) return profileGrants(p)
    }
  }
  // 3. Workspace default profile.
  if (ch.workspaceId) {
    const def = await db
      .select({
        id: schema.agentProfile.id,
        grantsAll: schema.agentProfile.grantsAll,
        capabilities: schema.agentProfile.capabilities,
      })
      .from(schema.agentProfile)
      .where(
        and(
          eq(schema.agentProfile.workspaceId, ch.workspaceId),
          eq(schema.agentProfile.isDefault, true)
        )
      )
      .limit(1)
      .then((r) => r[0] ?? null)
    if (def) return profileGrants(def)
  }
  // 4. Nothing provisioned → permissive (no behavior change).
  return PERMISSIVE_GRANTS
}
