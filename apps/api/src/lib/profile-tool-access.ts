import {
  BUILTIN_GROUPS,
  CONNECTOR_TOOLS,
  CONNECTORS,
  CUSTOM_TOOLS_GROUP_ID,
  enabledConnectorTools,
  type ProfileToolGroup,
  profileOverrides,
  STANDALONE_TOOLS,
} from "@repo/connectors"
import { and, asc, db, eq, schema } from "@repo/db"
import { BUILTIN_TOOL_GROUPS, type ProfileToolAccess } from "@repo/db/schema"
import { env } from "@repo/env/server"

type Reader = Pick<typeof db, "select">

// Every tool source a profile can choose from, with the tools the workspace
// currently allows. Web needs the deployment's Exa key.
export async function workspaceProfileToolGroups(
  workspaceId: string,
  reader: Reader = db
): Promise<ProfileToolGroup[]> {
  const [connections, servers, customTools] = await Promise.all([
    reader
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
    reader
      .select({
        id: schema.mcpServer.id,
        name: schema.mcpServer.name,
        description: schema.mcpServer.description,
        enabledTools: schema.mcpServer.enabledTools,
        toolMetadata: schema.mcpServer.toolMetadata,
      })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.workspaceId, workspaceId)),
    reader
      .select({
        id: schema.customTool.id,
        name: schema.customTool.name,
        description: schema.customTool.description,
      })
      .from(schema.customTool)
      .where(eq(schema.customTool.workspaceId, workspaceId))
      .orderBy(asc(schema.customTool.name)),
  ])
  const builtins: ProfileToolGroup[] = BUILTIN_TOOL_GROUPS.filter(
    (group) =>
      (group !== "web" || Boolean(env.EXA_API_KEY)) &&
      STANDALONE_TOOLS.some((tool) => tool.group === group)
  ).map((group) => ({
    kind: "builtin",
    id: group,
    name: BUILTIN_GROUPS[group].label,
    description: BUILTIN_GROUPS[group].description,
    tools: STANDALONE_TOOLS.filter((tool) => tool.group === group).map(
      (tool) => ({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        readOnlyHint: tool.readOnlyHint,
      })
    ),
  }))
  const services: ProfileToolGroup[] = [
    ...connections
      .filter((connection) => CONNECTOR_TOOLS[connection.provider].length > 0)
      .map((connection) => {
        const enabled = new Set(
          enabledConnectorTools(connection.provider, connection.enabledTools)
        )
        return {
          kind: "connector" as const,
          id: connection.provider,
          name: CONNECTORS[connection.provider].label,
          description: CONNECTORS[connection.provider].description,
          tools: CONNECTOR_TOOLS[connection.provider]
            .filter((tool) => enabled.has(tool.name))
            .map((tool) => ({
              name: tool.name,
              label: tool.label,
              description: tool.description,
              readOnlyHint: tool.readOnlyHint as boolean | undefined,
            })),
        }
      }),
    ...servers.map((server) => ({
      kind: "mcpServer" as const,
      id: server.id,
      name: server.name,
      description: server.description,
      tools: server.enabledTools.map((name) => {
        const metadata = server.toolMetadata.find((tool) => tool.name === name)
        return {
          name,
          label: name,
          description: metadata?.description ?? "",
          readOnlyHint: metadata?.readOnlyHint,
        }
      }),
    })),
  ].sort((left, right) => left.name.localeCompare(right.name))
  // Listed even when empty: following the workspace includes tools added later.
  const apiTools: ProfileToolGroup = {
    kind: "customTools",
    id: CUSTOM_TOOLS_GROUP_ID,
    name: "API tools",
    description: "Custom HTTP tools added in this workspace.",
    tools: customTools.map((tool) => ({
      name: tool.id,
      label: tool.name,
      description: tool.description,
    })),
  }
  return [...builtins, ...services, apiTools]
}

export async function profileToolAccessIssue(
  workspaceId: string,
  access: ProfileToolAccess,
  reader: Reader = db
): Promise<string | null> {
  const groups = await workspaceProfileToolGroups(workspaceId, reader)
  for (const override of profileOverrides(access)) {
    const group = groups.find(
      (candidate) =>
        candidate.kind === override.kind && candidate.id === override.id
    )
    if (!group)
      return "Tool access must reference tools available in this workspace"
    if (override.selection.mode !== "custom") continue
    const enabled = new Set(group.tools.map((tool) => tool.name))
    if (override.selection.tools.some((name) => !enabled.has(name)))
      return `Select tools available for ${group.name} in this workspace`
  }
  return null
}
