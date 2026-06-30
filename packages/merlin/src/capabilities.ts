import { and, db, eq, schema } from "@repo/db"
import { ALL_MERLIN_CAPABILITIES, type MerlinCapability } from "@repo/db/schema"

function profileCapabilities(profile: {
  grantsAll: boolean
  capabilities: MerlinCapability[]
}): MerlinCapability[] {
  return profile.grantsAll ? ALL_MERLIN_CAPABILITIES : profile.capabilities
}

async function getProfile(id: string, workspaceId: string) {
  return db
    .select({
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
): Promise<MerlinCapability[]> {
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
  if (!ch) return ALL_MERLIN_CAPABILITIES

  // 1. Explicit channel profile (scoped to the channel's workspace).
  if (ch.agentProfileId && ch.workspaceId) {
    const p = await getProfile(ch.agentProfileId, ch.workspaceId)
    if (p) return profileCapabilities(p)
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
      if (p) return profileCapabilities(p)
    }
  }
  // 3. Workspace default profile.
  if (ch.workspaceId) {
    const def = await db
      .select({
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
    if (def) return profileCapabilities(def)
  }
  // 4. Nothing provisioned → permissive (no behavior change).
  return ALL_MERLIN_CAPABILITIES
}
