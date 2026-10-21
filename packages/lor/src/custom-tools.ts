import { CONNECTOR_TOOL_NAMES } from "@repo/connectors"
import { and, asc, db, eq, inArray, schema } from "@repo/db"
import type { CustomTool } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"
import { dynamicTool, jsonSchema, type ToolSet } from "ai"
import { logger } from "./logger"

// User-defined HTTP tools (custom_tool rows), bound per the channel profile's
// toolAccess.customTools: all workspace tools (the default) or listed ids.
// Templates use {{args.x}} / {{secrets.KEY}} placeholders;
// secrets are decrypted only at call time and never appear in tool results.
// See reference/automation-primitives.md §4.

export const CUSTOM_TOOL_NAME_REGEX = /^[a-z][a-z0-9_]{2,63}$/

// Create-time UX guard against shadowing built-ins. Drift is tolerated: the
// bind-time skip below is the real enforcement (built-ins always win), so a
// stale list only means a collision surfaces at bind instead of create.
export const RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...CONNECTOR_TOOL_NAMES,
  "search",
  "read_thread",
  "view_image",
  "read_attachment",
  "read_call",
  "fetch_source",
  "search_sources",
  "memory_ls",
  "memory_tree",
  "memory_read",
  "memory_write",
  "memory_edit",
  "memory_mkdir",
  "memory_move",
  "memory_link",
  // Pi's sandbox tools (find is exposed as glob).
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "glob",
  "ls",
  "propose_instructions",
  "propose_workspace_change",
  "react_to_message",
  "search_web",
  "fetch_web",
  "search_github",
  "fetch_github",
  "investigate_code",
  "propose_code_change",
  "create_artifacts",
  "start_plan",
  "update_plan",
  "complete_plan",
  "request_approval",
  // Removed Act tools: old run transcripts still hold their calls.
  "post_channel_message",
  "create_plan",
  "search_linear",
  "list_linear_issues",
  "fetch_linear",
  "create_linear_issue",
  "comment_linear",
  "update_linear_issue",
  "search_attio",
  "fetch_attio_record",
  "query_attio",
  "fetch_attio_activity",
  "search_notion",
  "fetch_notion_page",
  "query_notion_data_source",
  "list_notion_users",
  "list_cloudwatch_log_groups",
  "search_cloudwatch_logs",
  "list_cloudwatch_metrics",
  "get_cloudwatch_metrics",
  "search_datadog_logs",
  "analyze_datadog_logs",
])

export const CUSTOM_TOOLS_PROMPT_LINE =
  "- Custom tools: this workspace defined its own tools (they appear alongside your built-in ones); each tool's description says what it does and when to use it."

const REQUEST_TIMEOUT_MS = 15_000
const RESPONSE_MAX_CHARS = 256 * 1024

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"])

// SSRF guard, applied to the stored template at create time and to the final
// interpolated URL at call time. HTTPS-only; hostnames must be public-looking:
// no IP literals, no localhost/.local/.internal, no dotless intranet names.
// DNS-pinning is a hosted-hardening follow-up (automation-primitives.md §4).
export function customToolUrlIssue(rawUrl: string): string | null {
  let url: URL
  try {
    // Placeholders in the host would break parsing — that's rejected too,
    // deliberately: args/secrets may not choose the host.
    url = new URL(rawUrl)
  } catch {
    return "URL is not valid"
  }
  if (url.protocol !== "https:") return "URL must use https"
  if (url.username || url.password) {
    return "Credentials belong in headers or secrets, not the URL"
  }
  const host = url.hostname.toLowerCase()
  if (host.startsWith("[")) return "IPv6 literals are not allowed"
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return "IP literals are not allowed"
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    return "Internal hostnames are not allowed"
  }
  // Also rejects template placeholders in the host — args/secrets may not
  // choose where a request goes.
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) {
    return "Hostname must be a public domain"
  }
  return null
}

const PLACEHOLDER_REGEX = /\{\{\s*(args|secrets)\.([A-Za-z0-9_]+)\s*\}\}/g

function stringifyArg(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

// Substitute placeholders for one request part. Encoding differs by context:
// URL values are percent-encoded, body values substitute their JSON encoding
// (so `"q": {{args.q}}` is correct for strings/numbers/objects alike), header
// values go in raw. Unknown references throw — a typo'd template should fail
// loudly, not silently send an empty field.
// Substituted header values reach fetch as raw bytes: a CR/LF (or any control
// char) would split the request, and anything above latin-1 can't be encoded
// at all. Templates are validated at save time, but the *values* here can come
// from secrets or model-supplied args, so the choke point has to be here.
function assertHeaderSafe(value: string, key: string): string {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if ((code < 0x20 && code !== 0x09) || code === 0x7f || code > 0xff) {
      throw new Error(
        `Value for ${key} can't be used in a header (invalid character)`
      )
    }
  }
  return value
}

export function renderTemplate(
  template: string,
  context: "url" | "header" | "body",
  args: Record<string, unknown>,
  secrets: Record<string, string>
): string {
  return template.replace(PLACEHOLDER_REGEX, (_match, kind, key) => {
    const value =
      kind === "secrets"
        ? secrets[key]
        : Object.hasOwn(args, key)
          ? args[key]
          : undefined
    if (value === undefined) {
      throw new Error(`Template references unknown ${kind}.${key}`)
    }
    if (context === "body") return JSON.stringify(value)
    if (context === "url") return encodeURIComponent(stringifyArg(value))
    return assertHeaderSafe(stringifyArg(value), `${kind}.${key}`)
  })
}

// The declared content type decides whether a body template must be JSON:
// absent (we default to application/json) or json-ish → the template has to
// parse with placeholders treated as values. Only an explicit non-JSON
// Content-Type (form-encoded OAuth endpoints, raw GraphQL, XML) opts out.
export function bodyMustBeJson(headers: Record<string, string>): boolean {
  const contentType = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "content-type"
  )?.[1]
  return !contentType || contentType.toLowerCase().includes("json")
}

// Placeholders substitute to sentinel numbers, valid both in value position
// and inside strings — so a template lints exactly as its final form would.
export function bodyTemplateJsonIssue(template: string): string | null {
  const substituted = template.replace(PLACEHOLDER_REGEX, "880880000")
  try {
    JSON.parse(substituted)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid JSON"
  }
}

export type CustomToolRequest = {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

type CustomToolRow = Pick<
  CustomTool,
  "name" | "method" | "urlTemplate" | "headers" | "bodyTemplate"
>

// Pure request assembly, split out for tests. Throws on template/URL issues.
export function buildCustomToolRequest(
  row: CustomToolRow,
  args: Record<string, unknown>,
  secrets: Record<string, string>
): CustomToolRequest {
  const url = renderTemplate(row.urlTemplate, "url", args, secrets)
  const issue = customToolUrlIssue(url)
  if (issue) throw new Error(issue)

  const headers: Record<string, string> = {}
  for (const [name, template] of Object.entries(row.headers)) {
    headers[name] = renderTemplate(template, "header", args, secrets)
  }

  let body: string | null = null
  if (BODY_METHODS.has(row.method)) {
    body = row.bodyTemplate
      ? renderTemplate(row.bodyTemplate, "body", args, secrets)
      : JSON.stringify(args)
    const hasContentType = Object.keys(headers).some(
      (h) => h.toLowerCase() === "content-type"
    )
    if (!hasContentType) headers["Content-Type"] = "application/json"
  }

  return { url, method: row.method, headers, body }
}

function decryptSecrets(
  row: Pick<CustomTool, "name" | "secrets">,
  key: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, ciphertext] of Object.entries(row.secrets)) {
    out[name] = decryptSecret(ciphertext, key)
  }
  return out
}

// Read at most `maxChars` from the body, then cancel — response.text() would
// buffer an arbitrarily large (or endless) body in memory first.
async function readBodyCapped(
  response: Response,
  maxChars: number
): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  try {
    while (text.length < maxChars) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return text.slice(0, maxChars)
}

async function executeCustomTool(
  row: CustomToolRow & Pick<CustomTool, "secrets">,
  input: unknown
): Promise<unknown> {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return { error: "Custom tools are not configured on this server" }
  const args =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  try {
    const secrets = decryptSecrets(row, key)
    const request = buildCustomToolRequest(row, args, secrets)
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== null ? { body: request.body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await readBodyCapped(response, RESPONSE_MAX_CHARS)
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {}
    return { status: response.status, ok: response.ok, body }
  } catch (err) {
    // Template errors carry safe, user-authored references; fetch errors are
    // generic. Neither can contain a secret value.
    logger.warn({ err, tool: row.name }, "Custom tool call failed")
    return { error: err instanceof Error ? err.message : "Request failed" }
  }
}

// The channel's granted custom tools as a runtime ToolSet (`grant` comes from
// resolveChannelCapabilities: "all" or an explicit tool-id list). Built-ins
// always win a name collision (the tool is skipped and logged) — a workspace
// row must never shadow a first-party tool.
export async function workspaceCustomTools(
  workspaceId: string,
  takenNames: ReadonlySet<string>,
  grant: "all" | string[]
  // toolIds: bound tool name → custom_tool.id, so approval policy can gate a
  // single workspace tool.
): Promise<{ tools: ToolSet; toolIds: Record<string, string> } | null> {
  if (!env.INTEGRATION_ENCRYPTION_KEY) return null
  if (grant !== "all" && grant.length === 0) return null
  const rows = await db
    .select({
      id: schema.customTool.id,
      name: schema.customTool.name,
      description: schema.customTool.description,
      argsSchema: schema.customTool.argsSchema,
      method: schema.customTool.method,
      urlTemplate: schema.customTool.urlTemplate,
      headers: schema.customTool.headers,
      bodyTemplate: schema.customTool.bodyTemplate,
      secrets: schema.customTool.secrets,
    })
    .from(schema.customTool)
    .where(
      and(
        eq(schema.customTool.workspaceId, workspaceId),
        grant === "all" ? undefined : inArray(schema.customTool.id, grant)
      )
    )
    .orderBy(asc(schema.customTool.name))

  const tools: ToolSet = {}
  const toolIds: Record<string, string> = {}
  for (const row of rows) {
    if (takenNames.has(row.name) || !CUSTOM_TOOL_NAME_REGEX.test(row.name)) {
      logger.warn(
        { workspaceId, tool: row.name },
        "Custom tool skipped; name collides with a built-in or is invalid"
      )
      continue
    }
    tools[row.name] = dynamicTool({
      description: row.description,
      inputSchema: jsonSchema(row.argsSchema),
      execute: (input) => executeCustomTool(row, input),
    })
    toolIds[row.name] = row.id
  }
  return Object.keys(tools).length > 0 ? { tools, toolIds } : null
}
