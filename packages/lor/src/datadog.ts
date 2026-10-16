import { createMCPClient } from "@ai-sdk/mcp"
import { and, db, eq, schema } from "@repo/db"
import type { ToolSet } from "ai"
import { logger } from "./logger"
import { getDatadogCredentials } from "./providers/datadog"

// Datadog's managed MCP server (Streamable HTTP, key-header auth). The path is
// versioned "unstable" upstream — expect it to move when Datadog GAs the server.
const MCP_PATH = "/api/unstable/mcp-server/mcp?toolsets=core"

// Allowlist over the server's core toolset: schemas and descriptions come from
// Datadog, but an upstream tool addition can't silently widen Lor's surface.
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

// Bound on the handshake + tools/list; the MCP SDK's own request timeout is 60s,
// far too long to hold up the start of a chat response.
const MCP_SETUP_TIMEOUT_MS = 8_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms`)),
      ms
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

// One MCP session per response: created when a Datadog tool is selected,
// closed by respond() after the stream finishes. Null (no tools,
// no prompt line) when credentials are missing, the server is unreachable, or
// setup exceeds the timeout.
export async function datadogMcpTools(
  externalId: string
): Promise<DatadogMcp | null> {
  const creds = await getDatadogCredentials(externalId)
  if (!creds) return null

  const setup = (async () => {
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: `https://mcp.${creds.site}${MCP_PATH}`,
        headers: {
          DD_API_KEY: creds.apiKey,
          DD_APPLICATION_KEY: creds.appKey,
        },
      },
    })
    try {
      return { client, serverTools: await client.tools() }
    } catch (err) {
      await client.close().catch(() => {})
      throw err
    }
  })()

  let session: Awaited<typeof setup>
  try {
    session = await withTimeout(setup, MCP_SETUP_TIMEOUT_MS)
  } catch (err) {
    logger.warn({ err }, "Datadog MCP unavailable")
    // The SDK has no abort hook; on timeout, close the session whenever the
    // still-running handshake eventually lands.
    setup.then(
      ({ client }) => client.close().catch(() => {}),
      () => {}
    )
    return null
  }

  const { client, serverTools } = session
  const tools: ToolSet = {}
  for (const name of DATADOG_TOOL_NAMES) {
    const serverTool = serverTools[name]
    if (serverTool) tools[name] = serverTool
  }
  if (Object.keys(tools).length === 0) {
    logger.warn("Datadog MCP server exposed none of the allowlisted tools")
    await client.close().catch(() => {})
    return null
  }
  return { tools, close: () => client.close().catch(() => {}) }
}
