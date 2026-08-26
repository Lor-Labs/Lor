import {
  and,
  count,
  db,
  desc,
  eq,
  inArray,
  isUniqueViolation,
  schema,
} from "@repo/db"
import type { McpServer } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { customToolUrlIssue, renderTemplate } from "@repo/merlin/custom-tools"
import { initialMcpServerOAuthStatus } from "@repo/merlin/mcp-server-oauth"
import { discoverMcpServer as discoverMcp } from "@repo/merlin/mcp-servers"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import {
  assertWorkspacePermission,
  hasWorkspacePermission,
} from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  CreateMcpServerRoute,
  DeleteMcpServerRoute,
  DiscoverMcpServerRoute,
  ListMcpServersRoute,
  RediscoverMcpServerRoute,
  UpdateMcpServerRoute,
} from "@/routes/v1/mcp-servers/routes"

// Header values may embed literal credentials (typed directly instead of via
// a {{secrets.*}} reference). Members without the manage permission get header
// names with masked values; values built purely from secret references stay
// legible (they're placeholders, not credentials).
const SECRET_REF_REGEX = /\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}/g
function redactedHeaders(
  headers: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      value.replace(SECRET_REF_REGEX, "").trim() === "" ? value : "••••••",
    ])
  )
}

// Secret values are write-only: stored encrypted, surfaced as names only.
function toResponse(
  row: McpServer,
  usedByProfiles: number,
  revealHeaders: boolean,
  oauthAuthorizer: { id: string; name: string } | null
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    authMode: row.authMode,
    oauthStatus: row.oauthStatus,
    oauthAuthorizedBy: oauthAuthorizer,
    oauthAuthorizedAt: row.oauthAuthorizedAt?.toISOString() ?? null,
    headers: revealHeaders ? row.headers : redactedHeaders(row.headers),
    secretNames: Object.keys(row.secrets),
    enabledTools: row.enabledTools,
    usedByProfiles,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function oauthAuthorizers(
  userIds: (string | null)[]
): Promise<Map<string, { id: string; name: string }>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(inArray(schema.user.id, ids))
  return new Map(rows.map((row) => [row.id, row]))
}

async function grantCounts(
  mcpServerIds: string[]
): Promise<Map<string, number>> {
  if (mcpServerIds.length === 0) return new Map()
  const rows = await db
    .select({
      mcpServerId: schema.agentProfileMcpServer.mcpServerId,
      profiles: count(),
    })
    .from(schema.agentProfileMcpServer)
    .where(inArray(schema.agentProfileMcpServer.mcpServerId, mcpServerIds))
    .groupBy(schema.agentProfileMcpServer.mcpServerId)
  return new Map(rows.map((r) => [r.mcpServerId, r.profiles]))
}

// Final request headers for a handshake: secret placeholders substituted.
function renderedHeaders(
  headers: Record<string, string>,
  secrets: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, template] of Object.entries(headers)) {
    out[name] = renderTemplate(template, "header", {}, secrets)
  }
  return out
}

export const listMcpServers: AppRouteHandler<ListMcpServersRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const rows = await db
    .select()
    .from(schema.mcpServer)
    .where(eq(schema.mcpServer.workspaceId, workspace.id))
    .orderBy(desc(schema.mcpServer.createdAt))
  const [counts, authorizers] = await Promise.all([
    grantCounts(rows.map((r) => r.id)),
    oauthAuthorizers(rows.map((r) => r.oauthAuthorizedBy)),
  ])
  const revealHeaders = hasWorkspacePermission(c.var.member, workspace, {
    channel: ["update"],
  })
  return c.json(
    {
      servers: rows.map((r) =>
        toResponse(
          r,
          counts.get(r.id) ?? 0,
          revealHeaders,
          r.oauthAuthorizedBy
            ? (authorizers.get(r.oauthAuthorizedBy) ?? null)
            : null
        )
      ),
    },
    HttpStatusCodes.OK
  )
}

export const createMcpServer: AppRouteHandler<CreateMcpServerRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const body = c.req.valid("json")

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    logger.error(
      "MCP servers are disabled: INTEGRATION_ENCRYPTION_KEY is not configured"
    )
    return c.json(
      { success: false, message: "MCP servers are unavailable" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const urlIssue = customToolUrlIssue(body.url)
  if (urlIssue) {
    return c.json(
      { success: false, message: urlIssue },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const secrets = Object.fromEntries(
    Object.entries(body.secrets).map(([name, value]) => [
      name,
      encryptSecret(value, key),
    ])
  )

  const row = await db
    .insert(schema.mcpServer)
    .values({
      workspaceId: workspace.id,
      createdBy: c.var.user.id,
      name: body.name,
      description: body.description,
      url: body.url,
      authMode: body.authMode,
      oauthStatus: initialMcpServerOAuthStatus(body.authMode),
      headers: body.headers,
      secrets,
      enabledTools: body.enabledTools,
    })
    .returning()
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      if (isUniqueViolation(err)) return "conflict" as const
      throw err
    })
  if (row === "conflict" || !row) {
    return c.json(
      { success: false, message: "A server with that name already exists" },
      HttpStatusCodes.CONFLICT
    )
  }
  return c.json({ server: toResponse(row, 0, true, null) }, HttpStatusCodes.OK)
}

export const updateMcpServer: AppRouteHandler<UpdateMcpServerRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { mcpServerId } = c.req.valid("param")
  const body = c.req.valid("json")

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return c.json(
      { success: false, message: "MCP servers are unavailable" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (body.url !== undefined) {
    const urlIssue = customToolUrlIssue(body.url)
    if (urlIssue) {
      return c.json(
        { success: false, message: urlIssue },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

  const existing = await db
    .select()
    .from(schema.mcpServer)
    .where(
      and(
        eq(schema.mcpServer.id, mcpServerId),
        eq(schema.mcpServer.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!existing) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (existing.authMode === "oauth" && body.enabledTools !== undefined) {
    return c.json(
      {
        success: false,
        message: "OAuth tools can only be enabled after authorization",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (
    existing.authMode === "oauth" &&
    body.headers &&
    Object.keys(body.headers).some(
      (header) => header.toLowerCase() === "authorization"
    )
  ) {
    return c.json(
      {
        success: false,
        message: "OAuth servers cannot define an Authorization header",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Merge semantics: string sets (encrypted), null deletes, absent keeps.
  let secrets: Record<string, string> | undefined
  if (body.secrets !== undefined) {
    // Count the merged set before encrypting — a patch isn't size-capped by
    // the schema (null deletes need to pass through), so an oversized body
    // would otherwise buy N encryptions before the rejection.
    const merged = new Set(Object.keys(existing.secrets))
    for (const [name, value] of Object.entries(body.secrets)) {
      if (value === null) merged.delete(name)
      else merged.add(name)
    }
    if (merged.size > 20) {
      return c.json(
        { success: false, message: "At most 20 secrets" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
    secrets = { ...existing.secrets }
    for (const [name, value] of Object.entries(body.secrets)) {
      if (value === null) delete secrets[name]
      else secrets[name] = encryptSecret(value, key)
    }
  }

  const row = await db
    .update(schema.mcpServer)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.headers !== undefined ? { headers: body.headers } : {}),
      ...(body.enabledTools !== undefined
        ? { enabledTools: body.enabledTools }
        : {}),
      ...(secrets !== undefined ? { secrets } : {}),
    })
    .where(eq(schema.mcpServer.id, existing.id))
    .returning()
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      if (isUniqueViolation(err)) return "conflict" as const
      throw err
    })
  if (row === "conflict") {
    return c.json(
      { success: false, message: "A server with that name already exists" },
      HttpStatusCodes.CONFLICT
    )
  }
  if (!row) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const [counts, authorizers] = await Promise.all([
    grantCounts([row.id]),
    oauthAuthorizers([row.oauthAuthorizedBy]),
  ])
  return c.json(
    {
      server: toResponse(
        row,
        counts.get(row.id) ?? 0,
        true,
        row.oauthAuthorizedBy
          ? (authorizers.get(row.oauthAuthorizedBy) ?? null)
          : null
      ),
    },
    HttpStatusCodes.OK
  )
}

export const deleteMcpServer: AppRouteHandler<DeleteMcpServerRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { mcpServerId } = c.req.valid("param")

  // Profile grants cascade away (agent_profile_mcp_server FK).
  const row = await db
    .delete(schema.mcpServer)
    .where(
      and(
        eq(schema.mcpServer.id, mcpServerId),
        eq(schema.mcpServer.workspaceId, workspace.id)
      )
    )
    .returning({ id: schema.mcpServer.id })
    .then((rows) => rows[0])
  if (!row) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const discoverMcpServer: AppRouteHandler<
  DiscoverMcpServerRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const body = c.req.valid("json")

  const urlIssue = customToolUrlIssue(body.url)
  if (urlIssue) {
    return c.json(
      { success: false, message: urlIssue },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  // A header template referencing an unknown secret throws — a sender error,
  // not a server fault.
  let headers: Record<string, string>
  try {
    headers = renderedHeaders(body.headers, body.secrets)
  } catch (err) {
    return c.json(
      {
        success: false,
        message: err instanceof Error ? err.message : "Invalid header template",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const result = await discoverMcp({
    url: body.url,
    headers,
  })
  if ("error" in result) {
    return c.json(
      { success: false, message: result.error },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  return c.json({ tools: result.tools }, HttpStatusCodes.OK)
}

export const rediscoverMcpServer: AppRouteHandler<
  RediscoverMcpServerRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, { channel: ["update"] })
  const { mcpServerId } = c.req.valid("param")
  const body = c.req.valid("json")

  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return c.json(
      { success: false, message: "MCP servers are unavailable" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const existing = await db
    .select()
    .from(schema.mcpServer)
    .where(
      and(
        eq(schema.mcpServer.id, mcpServerId),
        eq(schema.mcpServer.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!existing) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const url = body.url ?? existing.url
  const urlIssue = customToolUrlIssue(url)
  if (urlIssue) {
    return c.json(
      { success: false, message: urlIssue },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  // Stored secrets decrypted, unsaved plaintext ones overlaid on top. Write-
  // only secrets must never leave for a host the workspace didn't save them
  // against, so a url override tests with the request's own secrets only.
  const secrets: Record<string, string> = {}
  if (url === existing.url) {
    for (const [name, ciphertext] of Object.entries(existing.secrets)) {
      try {
        secrets[name] = decryptSecret(ciphertext, key)
      } catch {
        // An undecryptable secret renders as empty; the handshake will fail
        // with the server's own auth error, which is more actionable.
        secrets[name] = ""
      }
    }
  }
  Object.assign(secrets, body.secrets)

  let headers: Record<string, string>
  try {
    headers = renderedHeaders(body.headers ?? existing.headers, secrets)
  } catch (err) {
    return c.json(
      {
        success: false,
        message: err instanceof Error ? err.message : "Invalid header template",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const result = await discoverMcp({
    url,
    headers,
  })
  if ("error" in result) {
    return c.json(
      { success: false, message: result.error },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  return c.json({ tools: result.tools }, HttpStatusCodes.OK)
}
