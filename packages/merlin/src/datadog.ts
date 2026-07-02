import { createMCPClient, type MCPClient } from "@ai-sdk/mcp"
import { and, db, eq, schema } from "@repo/db"
import type { ToolSet } from "ai"
import { logger } from "./logger"
import { getDatadogCredentials } from "./providers/datadog"

// Datadog's managed MCP server (Streamable HTTP, key-header auth). The path is
// versioned "unstable" upstream — expect it to move when Datadog GAs the server.
const MCP_PATH = "/api/unstable/mcp-server/mcp?toolsets=core"

// Allowlist over the server's core toolset: schemas and descriptions come from
// Datadog, but an upstream tool addition can't silently widen Merlin's surface.
export const DATADOG_TOOL_NAMES = [
  "search_datadog_logs",
  "analyze_datadog_logs",
] as const

export async function resolveWorkspaceDatadog(
  workspaceId: string
): Promise<{ externalId: string } | null> {
  const conn = await db
    .select({ externalId: schema.integrationConnection.externalId })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.workspaceId, workspaceId),
        eq(schema.integrationConnection.provider, "datadog"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  return conn ? { externalId: conn.externalId } : null
}

export type DatadogMcp = {
  tools: ToolSet
  close: () => Promise<void>
}

// One MCP session per response: created when the channel grants the datadog
// capability, closed by respond() after the stream finishes. Null (no tools,
// no prompt line) when credentials are missing or the server is unreachable.
export async function datadogMcpTools(
  externalId: string
): Promise<DatadogMcp | null> {
  const creds = await getDatadogCredentials(externalId)
  if (!creds) return null

  let client: MCPClient | undefined
  try {
    client = await createMCPClient({
      transport: {
        type: "http",
        url: `https://mcp.${creds.site}${MCP_PATH}`,
        headers: {
          DD_API_KEY: creds.apiKey,
          DD_APPLICATION_KEY: creds.appKey,
        },
      },
    })
    const serverTools = await client.tools()
    const tools: ToolSet = {}
    for (const name of DATADOG_TOOL_NAMES) {
      const serverTool = serverTools[name]
      if (serverTool) tools[name] = serverTool
    }
    if (Object.keys(tools).length === 0) {
      logger.warn("Datadog MCP server exposed none of the allowlisted tools")
      await client.close()
      return null
    }
    const open = client
    return { tools, close: () => open.close().catch(() => {}) }
  } catch (err) {
    logger.warn({ err }, "Datadog MCP unavailable")
    await client?.close().catch(() => {})
    return null
  }
}
