import { createMCPClient, type OAuthClientProvider } from "@ai-sdk/mcp"
import { and, db, eq, inArray, schema } from "@repo/db"
import type { McpServer } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"
import type { ToolSet } from "ai"
import { customToolUrlIssue, renderTemplate } from "./custom-tools"
import { logger } from "./logger"
import {
  createGuardedMcpFetch,
  type GuardedMcpFetch,
  McpNetworkPolicyError,
} from "./mcp-guarded-fetch"
import { createRuntimeMcpOAuthProvider } from "./mcp-runtime-oauth"

// Remote MCP servers (mcp_server rows), generalizing the Datadog MCP
// pattern: one session per respond() call, closed when the stream finishes.
// The server owns its tool list/schemas; the row's `enabledTools` allowlist
// bounds what binds, and the channel profile's grant picks which servers.
// See reference/automation-primitives.md §4.

export const MCP_SERVERS_PROMPT_LINE =
  "- MCP servers: this workspace connected external MCP servers; their tools appear alongside your built-in ones — each tool's description says what it does."

// The prompt line for the servers actually bound this response — the
// workspace's own "when to use this" note rides next to each server name.
export function mcpServersPromptLine(
  servers: { name: string; description: string }[]
): string {
  const listed = servers
    .map((s) => (s.description ? `${s.name} (${s.description})` : s.name))
    .join("; ")
  return `${MCP_SERVERS_PROMPT_LINE} Connected: ${listed}.`
}

// Bound on handshake + tools/list; the MCP SDK's own request timeout is 60s,
// far too long to hold up the start of a chat response. Shared across servers
// (handshakes run in parallel).
const SETUP_TIMEOUT_MS = 8_000
// Same cap as custom-tool responses: a tool result is model input, not a blob
// store.
const RESULT_MAX_CHARS = 256 * 1024

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

type ServerRow = Pick<
  McpServer,
  | "id"
  | "workspaceId"
  | "name"
  | "description"
  | "url"
  | "headers"
  | "secrets"
  | "enabledTools"
  | "authMode"
  | "oauthStatus"
  | "oauthCredentials"
> & { workspaceSlug: string }

function decryptedHeaders(
  row: Pick<ServerRow, "name" | "headers" | "secrets">,
  key: string
): Record<string, string> {
  const secrets: Record<string, string> = {}
  for (const [name, ciphertext] of Object.entries(row.secrets)) {
    secrets[name] = decryptSecret(ciphertext, key)
  }
  const headers: Record<string, string> = {}
  for (const [name, template] of Object.entries(row.headers)) {
    headers[name] = renderTemplate(template, "header", {}, secrets)
  }
  return headers
}

function capResult(result: unknown): unknown {
  const text = typeof result === "string" ? result : JSON.stringify(result)
  if (typeof text !== "string" || text.length <= RESULT_MAX_CHARS) {
    return result
  }
  return `${text.slice(0, RESULT_MAX_CHARS)}… [truncated]`
}

// Cap what a server tool can pump into the model per call.
function withCappedResults(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {}
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute?.bind(tool)
    wrapped[name] = execute
      ? {
          ...tool,
          execute: async (...args) => capResult(await execute(...args)),
        }
      : tool
  }
  return wrapped
}

async function connectServer(input: {
  url: string
  headers: Record<string, string>
  authProvider?: OAuthClientProvider
  guardedFetch?: GuardedMcpFetch
}): Promise<{ client: { close: () => Promise<void> }; tools: ToolSet }> {
  // Re-checked at connect time so a tampered row can't reach internal hosts.
  const issue = customToolUrlIssue(input.url)
  if (issue) throw new Error(issue)
  // One memoized close for every losing path: a tools() failure, the timeout,
  // or a client that only finishes connecting after we gave up. The session is
  // captured as soon as it exists because a tools() call that never settles
  // leaves `setup` pending forever — no .then() cleanup could ever fire.
  const state: {
    session: { close: () => Promise<void> } | null
    closed: boolean
    abandoned: boolean
  } = { session: null, closed: false, abandoned: false }
  const closeOnce = () => {
    if (state.closed || !state.session) return
    state.closed = true
    void state.session.close().catch(() => {})
  }
  const setup = (async () => {
    const guardedFetch =
      input.guardedFetch ??
      createGuardedMcpFetch({
        resourceUrl: input.url,
        sensitiveHeaderNames: Object.keys(input.headers),
        timeoutMs: 60_000,
      })
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: input.url,
        headers: input.headers,
        authProvider: input.authProvider,
        fetch: guardedFetch,
        redirect: "error",
      },
    })
    state.session = client
    // Connected after the caller gave up: close now rather than waiting on a
    // tools() call whose result nobody wants (and which may never settle).
    if (state.abandoned) {
      closeOnce()
      throw new Error("Handshake abandoned")
    }
    try {
      return { client, tools: await client.tools() }
    } catch (err) {
      closeOnce()
      throw err
    }
  })()
  try {
    return await withTimeout(setup, SETUP_TIMEOUT_MS)
  } catch (err) {
    state.abandoned = true
    // Whatever exists now, plus whatever lands later — resolved OR rejected,
    // since a late rejection also leaves a live session behind.
    closeOnce()
    setup.then(closeOnce, closeOnce)
    throw err
  }
}

export type DiscoveredTool = { name: string; description: string }

function discoveredTools(tools: ToolSet): DiscoveredTool[] {
  return Object.entries(tools)
    .map(([name, tool]) => ({
      name,
      description:
        typeof tool.description === "string"
          ? tool.description.slice(0, 1000)
          : "",
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError"
}

function endpointHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "invalid"
  }
}

function discoveryError(error: unknown): string {
  return error instanceof McpNetworkPolicyError
    ? error.message
    : "Couldn't reach the server"
}

// Static/header handshake + tools/list without persisting anything — the
// settings UI uses this before save and when refreshing a saved static server.
export async function discoverMcpServer(input: {
  url: string
  headers: Record<string, string>
}): Promise<{ tools: DiscoveredTool[] } | { error: string }> {
  try {
    const { client, tools } = await connectServer(input)
    const discovered = discoveredTools(tools)
    await client.close().catch(() => {})
    return { tools: discovered }
  } catch (err) {
    logger.warn(
      {
        endpointHost: endpointHost(input.url),
        errorClass: errorClass(err),
      },
      "MCP discovery failed"
    )
    return { error: discoveryError(err) }
  }
}

export function mcpServerRuntimeEligible(
  server: Pick<
    McpServer,
    "authMode" | "oauthStatus" | "oauthCredentials" | "enabledTools"
  >
): boolean {
  if (server.enabledTools.length === 0) return false
  if (server.authMode === "static") return true
  return server.oauthStatus === "connected" && Boolean(server.oauthCredentials)
}

export function mcpServerGranted(
  mcpServerId: string,
  grant: "all" | readonly string[]
): boolean {
  return grant === "all" || grant.includes(mcpServerId)
}

export async function discoverSavedOAuthMcpServer(input: {
  server: McpServer
  workspaceSlug: string
  headers: Record<string, string>
  encryptionKey: string
}): Promise<{ tools: DiscoveredTool[] } | { error: string }> {
  if (
    input.server.authMode !== "oauth" ||
    !input.server.oauthCredentials ||
    !["needs_tool_review", "connected"].includes(input.server.oauthStatus ?? "")
  ) {
    return { error: "OAuth authorization is required" }
  }
  const { provider, guardedFetch } = createRuntimeMcpOAuthProvider({
    server: input.server,
    workspaceSlug: input.workspaceSlug,
    encryptionKey: input.encryptionKey,
  })
  try {
    const { client, tools } = await connectServer({
      url: input.server.url,
      headers: input.headers,
      authProvider: provider,
      guardedFetch,
    })
    const discovered = discoveredTools(tools)
    await client.close().catch(() => {})
    return { tools: discovered }
  } catch (error) {
    logger.warn(
      {
        mcpServerId: input.server.id,
        workspaceId: input.server.workspaceId,
        endpointHost: endpointHost(input.server.url),
        oauthPhase: "discovery",
        errorClass: errorClass(error),
      },
      "OAuth MCP discovery failed"
    )
    return { error: discoveryError(error) }
  }
}

export type McpServerSessions = {
  tools: ToolSet
  // The servers whose tools bound here, each with the tool names it
  // contributed — the caller filters again against built-ins/custom tools, so
  // the prompt line can only claim servers that survived that pass.
  servers: { name: string; description: string; toolNames: string[] }[]
  close: () => Promise<void>
}

// Connect the channel's granted servers (parallel, individually time-bounded;
// an unreachable server drops out rather than failing the response) and
// aggregate their allowlisted tools. Collisions resolve first-wins in
// (built-ins + custom tools) → server-name order; the loser is skipped and
// logged, never rebound.
export async function channelMcpServers(
  workspaceId: string,
  grant: "all" | string[],
  takenNames: ReadonlySet<string>
): Promise<McpServerSessions | null> {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return null
  if (grant !== "all" && grant.length === 0) return null

  const rows = await db
    .select({
      id: schema.mcpServer.id,
      workspaceId: schema.mcpServer.workspaceId,
      workspaceSlug: schema.workspace.slug,
      name: schema.mcpServer.name,
      description: schema.mcpServer.description,
      url: schema.mcpServer.url,
      headers: schema.mcpServer.headers,
      secrets: schema.mcpServer.secrets,
      enabledTools: schema.mcpServer.enabledTools,
      authMode: schema.mcpServer.authMode,
      oauthStatus: schema.mcpServer.oauthStatus,
      oauthCredentials: schema.mcpServer.oauthCredentials,
    })
    .from(schema.mcpServer)
    .innerJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.mcpServer.workspaceId)
    )
    .where(
      and(
        // Tenant belt: grant lists are workspace-validated at write time, but
        // never bind across workspaces regardless.
        eq(schema.mcpServer.workspaceId, workspaceId),
        grant === "all" ? undefined : inArray(schema.mcpServer.id, grant)
      )
    )
    .orderBy(schema.mcpServer.name)
  const servers = rows.filter(
    (row) => mcpServerGranted(row.id, grant) && mcpServerRuntimeEligible(row)
  )
  if (servers.length === 0) return null

  // Bound the parallel MCP handshakes — a profile granting many servers
  // shouldn't fan out unbounded sockets per response.
  const MAX_CONCURRENT_HANDSHAKES = 5
  type Session = {
    row: (typeof servers)[number]
    client: { close: () => Promise<void> }
    tools: ToolSet
  }
  const sessions: (Session | null)[] = new Array(servers.length).fill(null)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < servers.length) {
      const i = nextIndex++
      const row = servers[i]
      if (!row) continue
      try {
        const headers = decryptedHeaders(row, key)
        const connection =
          row.authMode === "oauth"
            ? createRuntimeMcpOAuthProvider({
                server: row,
                workspaceSlug: row.workspaceSlug,
                encryptionKey: key,
              })
            : null
        const { client, tools } = await connectServer({
          url: row.url,
          headers,
          authProvider: connection?.provider,
          guardedFetch: connection?.guardedFetch,
        })
        sessions[i] = { row, client, tools }
      } catch (err) {
        logger.warn(
          {
            mcpServerId: row.id,
            workspaceId: row.workspaceId,
            endpointHost: endpointHost(row.url),
            authMode: row.authMode,
            errorClass: errorClass(err),
          },
          "MCP server unavailable"
        )
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_HANDSHAKES, servers.length) },
      worker
    )
  )

  const tools: ToolSet = {}
  const bound: {
    name: string
    description: string
    toolNames: string[]
  }[] = []
  const clients: Array<{ close: () => Promise<void> }> = []
  for (const session of sessions) {
    if (!session) continue
    const allowed = new Set(session.row.enabledTools)
    const serverTools: ToolSet = {}
    for (const [name, tool] of Object.entries(session.tools)) {
      if (!allowed.has(name)) continue
      if (takenNames.has(name) || name in tools) {
        logger.warn(
          { mcpServerId: session.row.id, tool: name },
          "MCP tool skipped; name collides with an existing tool"
        )
        continue
      }
      serverTools[name] = tool
    }
    if (Object.keys(serverTools).length === 0) {
      await session.client.close().catch(() => {})
      continue
    }
    Object.assign(tools, withCappedResults(serverTools))
    bound.push({
      name: session.row.name,
      description: session.row.description,
      toolNames: Object.keys(serverTools),
    })
    clients.push(session.client)
  }

  if (Object.keys(tools).length === 0) return null
  return {
    tools,
    servers: bound,
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => {})))
    },
  }
}
