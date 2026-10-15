import { BETTERSTACK_TOOLS, enabledConnectorTools } from "@repo/connectors"
import type { LorCapability } from "@repo/db/schema"
import type { ToolSet } from "ai"
import { logger } from "./logger"
import { connectMcpServer } from "./mcp-servers"
import {
  BETTERSTACK_MCP_URL,
  betterstackHeaders,
  getBetterstackConnection,
} from "./providers/betterstack"

export async function betterstackMcpTools(
  workspaceId: string,
  capabilities: readonly LorCapability[]
) {
  try {
    const connection = await getBetterstackConnection(workspaceId)
    if (!connection) return null
    const enabled = new Set(
      enabledConnectorTools("betterstack", connection.enabledTools)
    )
    const catalog = BETTERSTACK_TOOLS.filter(
      (tool) =>
        enabled.has(tool.name) &&
        capabilities.includes(
          tool.readOnlyHint ? "betterstack" : "betterstack_write"
        )
    )
    if (catalog.length === 0) return null
    const session = await connectMcpServer({
      url: BETTERSTACK_MCP_URL,
      headers: betterstackHeaders(
        connection.token,
        catalog.map((tool) => tool.upstreamName)
      ),
    })
    const tools: ToolSet = {}
    for (const descriptor of catalog) {
      const upstream = session.tools[descriptor.upstreamName]
      if (upstream) tools[descriptor.name] = upstream
    }
    if (Object.keys(tools).length === 0) {
      await session.client.close().catch(() => {})
      return null
    }
    return { tools, close: () => session.client.close().catch(() => {}) }
  } catch {
    // SDK errors can contain request headers; never log the bearer token.
    logger.warn("Better Stack MCP unavailable")
    return null
  }
}

export const BETTERSTACK_PROMPT_LINE = `- The team's Better Stack: investigate application errors and uptime incidents separately; an error group does not mean the service is down. Discover applications/sources before querying, read the matching query-help tool before writing SQL, bound queries in time and rows, and use small windows. Only enabled tools are available. Resolve incidents or change error states only when asked; changes can notify people. Cite Better Stack URLs from results with normal Markdown links.`
