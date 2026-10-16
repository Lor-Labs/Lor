import {
  approvalTargetKey,
  CONNECTOR_TOOLS,
  CONNECTORS,
  parseApprovalTargetKey,
  STANDALONE_TOOLS,
} from "@repo/connectors"
import { and, asc, db, eq, schema } from "@repo/db"

type Reader = Pick<typeof db, "select">

export type ApprovalTargetRow = {
  key: string
  name: string
  label: string
  description: string
  group: "builtin" | "connector" | "custom_tool" | "mcp_server" | "unavailable"
  groupKey: string
  groupLabel: string
  readOnlyHint?: boolean
}

export async function workspaceApprovalTargets(
  workspaceId: string,
  reader: Reader = db
): Promise<ApprovalTargetRow[]> {
  const [tools, servers] = await Promise.all([
    reader
      .select({
        id: schema.customTool.id,
        name: schema.customTool.name,
        description: schema.customTool.description,
      })
      .from(schema.customTool)
      .where(eq(schema.customTool.workspaceId, workspaceId))
      .orderBy(asc(schema.customTool.name)),
    reader
      .select({
        id: schema.mcpServer.id,
        name: schema.mcpServer.name,
        enabledTools: schema.mcpServer.enabledTools,
        toolMetadata: schema.mcpServer.toolMetadata,
      })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.workspaceId, workspaceId))
      .orderBy(asc(schema.mcpServer.name)),
  ])
  return [
    ...STANDALONE_TOOLS.map((tool) => ({
      ...tool,
      key: approvalTargetKey({ kind: "builtinTool", toolName: tool.name }),
      group: "builtin" as const,
      groupKey: "builtin",
      groupLabel: "Built-in tools",
    })),
    ...Object.values(CONNECTORS).flatMap((connector) =>
      CONNECTOR_TOOLS[connector.id].map((tool) => ({
        ...tool,
        key: approvalTargetKey({ kind: "builtinTool", toolName: tool.name }),
        group: "connector" as const,
        groupKey: `connector:${connector.id}`,
        groupLabel: connector.label,
      }))
    ),
    ...tools.map((tool) => ({
      ...tool,
      label: tool.name,
      key: approvalTargetKey({ kind: "customTool", customToolId: tool.id }),
      group: "custom_tool" as const,
      groupKey: "custom_tool",
      groupLabel: "API tools",
    })),
    ...servers.flatMap((server) =>
      [...new Set(server.enabledTools)].map((name) => {
        const metadata = server.toolMetadata.find((tool) => tool.name === name)
        return {
          key: approvalTargetKey({
            kind: "mcpTool",
            mcpServerId: server.id,
            toolName: name,
          }),
          name,
          label: name,
          description: metadata?.description ?? "",
          readOnlyHint: metadata?.readOnlyHint,
          group: "mcp_server" as const,
          groupKey: `mcp_server:${server.id}`,
          groupLabel: server.name,
        }
      })
    ),
  ]
}

export async function approvalTargetIssue(
  workspaceId: string,
  key: string,
  reader: Reader = db
): Promise<string | null> {
  const target = parseApprovalTargetKey(key)
  if (!target) return "Unknown approval target"
  if (target.kind === "builtinTool") return null
  if (target.kind === "customTool") {
    const owned = await reader
      .select({ id: schema.customTool.id })
      .from(schema.customTool)
      .where(
        and(
          eq(schema.customTool.id, target.customToolId),
          eq(schema.customTool.workspaceId, workspaceId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    return owned ? null : "Unknown custom tool"
  }
  const server = await reader
    .select({ enabledTools: schema.mcpServer.enabledTools })
    .from(schema.mcpServer)
    .where(
      and(
        eq(schema.mcpServer.id, target.mcpServerId),
        eq(schema.mcpServer.workspaceId, workspaceId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  return server?.enabledTools.includes(target.toolName)
    ? null
    : "Select a tool enabled for an MCP server in this workspace"
}
