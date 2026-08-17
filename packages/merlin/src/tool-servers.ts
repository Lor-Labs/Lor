import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { createMCPClient } from "@ai-sdk/mcp"
import { and, db, eq, inArray, schema } from "@repo/db"
import type { ToolServer } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"
import type { ToolSet } from "ai"
import { customToolUrlIssue, renderTemplate } from "./custom-tools"
import { logger } from "./logger"

// Remote MCP tool servers (tool_server rows), generalizing the Datadog MCP
// pattern: one session per respond() call, closed when the stream finishes.
// The server owns its tool list/schemas; the row's `enabledTools` allowlist
// bounds what binds, and the channel profile's grant picks which servers.
// See reference/automation-primitives.md §4.

export const TOOL_SERVERS_PROMPT_LINE =
  "- Tool servers: this workspace connected external tool servers; their tools appear alongside your built-in ones — each tool's description says what it does."

// The prompt line for the servers actually bound this response — the
// workspace's own "when to use this" note rides next to each server name.
export function toolServersPromptLine(
  servers: { name: string; description: string }[]
): string {
  const listed = servers
    .map((s) => (s.description ? `${s.name} (${s.description})` : s.name))
    .join("; ")
  return `${TOOL_SERVERS_PROMPT_LINE} Connected: ${listed}.`
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
  ToolServer,
  "id" | "name" | "description" | "url" | "headers" | "secrets" | "enabledTools"
>

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

// Mirrors the worker's link-unfurl guard (apps/worker/src/jobs/link-unfurl-url.ts):
// customToolUrlIssue rejects internal-looking hostnames, but a public name can
// still resolve to a private address (split-horizon DNS / rebinding). Check
// every resolved address right before connecting; the SDK re-resolves when it
// dials, so this narrows — not eliminates — the TOCTOU window.
const PRIVATE_IP_REGEX =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|::1|fc|fd|fe80)/i

async function resolvedAddressIssue(rawUrl: string): Promise<string | null> {
  const hostname = new URL(rawUrl).hostname
  // IP literals are already rejected by customToolUrlIssue.
  if (isIP(hostname)) return null
  let addresses: { address: string }[]
  try {
    addresses = await lookup(hostname, { all: true })
  } catch {
    return "Hostname did not resolve"
  }
  if (addresses.some(({ address }) => PRIVATE_IP_REGEX.test(address))) {
    return "Hostname resolves to a private address"
  }
  return null
}

async function connectServer(input: {
  url: string
  headers: Record<string, string>
}): Promise<{ client: { close: () => Promise<void> }; tools: ToolSet }> {
  // Re-checked at connect time so a tampered row can't reach internal hosts.
  const issue = customToolUrlIssue(input.url)
  if (issue) throw new Error(issue)
  const setup = (async () => {
    const resolvedIssue = await resolvedAddressIssue(input.url)
    if (resolvedIssue) throw new Error(resolvedIssue)
    const client = await createMCPClient({
      transport: { type: "http", url: input.url, headers: input.headers },
    })
    try {
      return { client, tools: await client.tools() }
    } catch (err) {
      await client.close().catch(() => {})
      throw err
    }
  })()
  try {
    return await withTimeout(setup, SETUP_TIMEOUT_MS)
  } catch (err) {
    // The SDK has no abort hook; on timeout, close the session whenever the
    // still-running handshake eventually lands.
    setup.then(
      ({ client }) => client.close().catch(() => {}),
      () => {}
    )
    throw err
  }
}

export type DiscoveredTool = { name: string; description: string }

// Handshake + tools/list without persisting anything — the settings UI's
// "Connect & discover" step (both pre-save and refresh use this).
export async function discoverToolServer(input: {
  url: string
  headers: Record<string, string>
}): Promise<{ tools: DiscoveredTool[] } | { error: string }> {
  try {
    const { client, tools } = await connectServer(input)
    const discovered = Object.entries(tools)
      .map(([name, tool]) => ({
        name,
        description:
          typeof tool.description === "string"
            ? tool.description.slice(0, 1000)
            : "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    await client.close().catch(() => {})
    return { tools: discovered }
  } catch (err) {
    logger.warn({ err, url: input.url }, "MCP discovery failed")
    return {
      error: err instanceof Error ? err.message : "Couldn't reach the server",
    }
  }
}

export type ToolServerSessions = {
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
export async function channelToolServers(
  workspaceId: string,
  grant: "all" | string[],
  takenNames: ReadonlySet<string>
): Promise<ToolServerSessions | null> {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return null
  if (grant !== "all" && grant.length === 0) return null

  const rows = await db
    .select({
      id: schema.toolServer.id,
      name: schema.toolServer.name,
      description: schema.toolServer.description,
      url: schema.toolServer.url,
      headers: schema.toolServer.headers,
      secrets: schema.toolServer.secrets,
      enabledTools: schema.toolServer.enabledTools,
    })
    .from(schema.toolServer)
    .where(
      and(
        // Tenant belt: grant lists are workspace-validated at write time, but
        // never bind across workspaces regardless.
        eq(schema.toolServer.workspaceId, workspaceId),
        grant === "all" ? undefined : inArray(schema.toolServer.id, grant)
      )
    )
    .orderBy(schema.toolServer.name)
  const servers = rows.filter((row) => row.enabledTools.length > 0)
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
        const { client, tools } = await connectServer({ url: row.url, headers })
        sessions[i] = { row, client, tools }
      } catch (err) {
        logger.warn(
          { err, toolServerId: row.id, name: row.name },
          "MCP tool server unavailable"
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
          { toolServerId: session.row.id, tool: name },
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
