import {
  CONNECTOR_TOOLS,
  CONNECTORS,
  enabledConnectorTools,
} from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import type { ProfileToolAccess, ProfileToolSelection } from "@repo/db/schema"

type Reader = Pick<typeof db, "select">

export async function workspaceProfileToolGroups(
  workspaceId: string,
  reader: Reader = db
) {
  const [connections, servers] = await Promise.all([
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
  ])
  return [
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
}

export async function profileToolAccessIssue(
  workspaceId: string,
  access: ProfileToolAccess,
  reader: Reader = db
): Promise<string | null> {
  const groups = await workspaceProfileToolGroups(workspaceId, reader)
  for (const [kind, overrides] of [
    ["connector", access.connectors],
    ["mcpServer", access.mcpServers],
  ] as const) {
    for (const [id, selection] of Object.entries(overrides) as [
      string,
      ProfileToolSelection,
    ][]) {
      const group = groups.find(
        (candidate) => candidate.kind === kind && candidate.id === id
      )
      if (!group)
        return "Tool access must reference connected services in this workspace"
      if (selection.mode !== "custom") continue
      const enabled = new Set(group.tools.map((tool) => tool.name))
      if (selection.tools.some((name) => !enabled.has(name)))
        return `Select tools enabled for ${group.name} in this workspace`
    }
  }
  return null
}
