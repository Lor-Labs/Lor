import {
  CONNECTOR_TOOLS,
  enabledConnectorTools,
  profileSelectedTools,
} from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import {
  ALL_LOR_CAPABILITIES,
  DEFAULT_PROFILE_TOOL_ACCESS,
  type LorCapability,
  type ProfileToolAccess,
  profileToolAccessSchema,
} from "@repo/db/schema"

export type ChannelToolGrants = {
  // Standalone abilities only; connector access is resolved by tool name.
  capabilities: LorCapability[]
  connectorTools: string[]
  customTools: "all" | string[]
  mcpServers: string[]
  mcpTools: Record<string, string[]>
}

export const EMPTY_TOOL_GRANTS: ChannelToolGrants = {
  capabilities: [],
  connectorTools: [],
  customTools: [],
  mcpServers: [],
  mcpTools: {},
}

type Profile = {
  id: string
  grantsAll: boolean
  capabilities: LorCapability[]
  toolAccess: ProfileToolAccess
}

async function profileGrants(
  workspaceId: string,
  profile: Profile | null
): Promise<ChannelToolGrants> {
  const access = profile
    ? profileToolAccessSchema.parse(profile.toolAccess)
    : DEFAULT_PROFILE_TOOL_ACCESS
  const standaloneCaps =
    profile && !profile.grantsAll ? profile.capabilities : ALL_LOR_CAPABILITIES
  const allCustomTools =
    !profile || profile.grantsAll || standaloneCaps.includes("custom_tools")
  const [connections, mcpServers, customToolGrants] = await Promise.all([
    db
      .select({
        provider: schema.integrationConnection.provider,
        enabledTools: schema.integrationConnection.enabledTools,
      })
      .from(schema.integrationConnection)
      .where(
        and(
          eq(schema.integrationConnection.workspaceId, workspaceId),
          eq(schema.integrationConnection.status, "active")
        )
      ),
    db
      .select({
        id: schema.mcpServer.id,
        enabledTools: schema.mcpServer.enabledTools,
      })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.workspaceId, workspaceId)),
    profile && !allCustomTools
      ? db
          .select({ id: schema.agentProfileCustomTool.customToolId })
          .from(schema.agentProfileCustomTool)
          .where(eq(schema.agentProfileCustomTool.profileId, profile.id))
      : [],
  ])
  const capabilities = new Set(standaloneCaps)
  const connectorTools = new Set<string>()
  for (const connection of connections) {
    const selected = new Set(
      profileSelectedTools(
        enabledConnectorTools(connection.provider, connection.enabledTools),
        access.connectors[connection.provider]
      )
    )
    for (const descriptor of CONNECTOR_TOOLS[connection.provider]) {
      if (!selected.has(descriptor.name)) continue
      connectorTools.add(descriptor.name)
    }
  }
  const mcpTools: Record<string, string[]> = {}
  for (const server of mcpServers) {
    const selected = profileSelectedTools(
      server.enabledTools,
      access.mcpServers[server.id]
    )
    if (selected.length > 0) mcpTools[server.id] = selected
  }
  return {
    capabilities: [...capabilities],
    connectorTools: [...connectorTools],
    customTools: allCustomTools
      ? "all"
      : customToolGrants.map((grant) => grant.id),
    mcpServers: Object.keys(mcpTools),
    mcpTools,
  }
}

const profileColumns = {
  id: schema.agentProfile.id,
  grantsAll: schema.agentProfile.grantsAll,
  capabilities: schema.agentProfile.capabilities,
  toolAccess: schema.agentProfile.toolAccess,
}

async function getProfile(id: string, workspaceId: string) {
  return db
    .select(profileColumns)
    .from(schema.agentProfile)
    .where(
      and(
        eq(schema.agentProfile.id, id),
        eq(schema.agentProfile.workspaceId, workspaceId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export async function resolveWorkspaceCapabilities(
  workspaceId: string
): Promise<ChannelToolGrants> {
  const profile = await db
    .select(profileColumns)
    .from(schema.agentProfile)
    .where(
      and(
        eq(schema.agentProfile.workspaceId, workspaceId),
        eq(schema.agentProfile.isDefault, true)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return profileGrants(workspaceId, profile)
}

// Channel → parent category → workspace default. Missing overrides follow the
// workspace tool selection; explicit/custom selections only narrow it.
export async function resolveChannelCapabilities(
  channelId: string,
  workspaceId?: string
): Promise<ChannelToolGrants> {
  const channel = await db
    .select({
      agentProfileId: schema.channel.agentProfileId,
      parentId: schema.channel.parentId,
      workspaceId: schema.channel.workspaceId,
    })
    .from(schema.channel)
    .where(
      and(
        eq(schema.channel.id, channelId),
        workspaceId ? eq(schema.channel.workspaceId, workspaceId) : undefined
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!channel?.workspaceId) return EMPTY_TOOL_GRANTS
  if (channel.agentProfileId) {
    const profile = await getProfile(
      channel.agentProfileId,
      channel.workspaceId
    )
    if (!profile) throw new Error("Channel agent profile is unavailable")
    return profileGrants(channel.workspaceId, profile)
  }
  if (channel.parentId) {
    const parent = await db
      .select({ profileId: schema.channel.agentProfileId })
      .from(schema.channel)
      .where(
        and(
          eq(schema.channel.id, channel.parentId),
          eq(schema.channel.workspaceId, channel.workspaceId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (parent?.profileId) {
      const profile = await getProfile(parent.profileId, channel.workspaceId)
      if (!profile) throw new Error("Category agent profile is unavailable")
      return profileGrants(channel.workspaceId, profile)
    }
  }
  return resolveWorkspaceCapabilities(channel.workspaceId)
}
