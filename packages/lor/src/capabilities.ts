import {
  CONNECTOR_TOOLS,
  enabledConnectorTools,
  profileSelectedTools,
  STANDALONE_TOOLS,
} from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import {
  BUILTIN_TOOL_GROUPS,
  DEFAULT_PROFILE_TOOL_ACCESS,
  type ProfileToolAccess,
  profileToolAccessSchema,
} from "@repo/db/schema"

// Every source resolves to tool names (custom tools: ids) from the profile's
// toolAccess; a missing entry follows the workspace.
export type ChannelToolGrants = {
  builtinTools: string[]
  connectorTools: string[]
  customTools: "all" | string[]
  mcpServers: string[]
  mcpTools: Record<string, string[]>
}

export const EMPTY_TOOL_GRANTS: ChannelToolGrants = {
  builtinTools: [],
  connectorTools: [],
  customTools: [],
  mcpServers: [],
  mcpTools: {},
}

type Profile = {
  id: string
  toolAccess: ProfileToolAccess
}

async function profileGrants(
  workspaceId: string,
  profile: Profile | null
): Promise<ChannelToolGrants> {
  const access = profile
    ? profileToolAccessSchema.parse(profile.toolAccess)
    : DEFAULT_PROFILE_TOOL_ACCESS
  const builtinTools = BUILTIN_TOOL_GROUPS.flatMap((group) =>
    profileSelectedTools(
      STANDALONE_TOOLS.filter((tool) => tool.group === group).map(
        (tool) => tool.name
      ),
      access.builtins[group]
    )
  )
  const [connections, mcpServers] = await Promise.all([
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
  ])
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
  const custom = access.customTools
  return {
    builtinTools,
    connectorTools: [...connectorTools],
    // Ids are intersected with the workspace's rows when the tools bind.
    customTools:
      !custom || custom.mode === "workspace"
        ? "all"
        : custom.mode === "off"
          ? []
          : custom.tools,
    mcpServers: Object.keys(mcpTools),
    mcpTools,
  }
}

const profileColumns = {
  id: schema.agentProfile.id,
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
