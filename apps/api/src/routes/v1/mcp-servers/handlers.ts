import { profileSelectedTools } from "@repo/connectors"
import { and, db, desc, eq, inArray, isUniqueViolation, schema } from "@repo/db"
import type { McpServer } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { customToolUrlIssue, renderTemplate } from "@repo/lor/custom-tools"
import { initialMcpServerOAuthStatus } from "@repo/lor/mcp-server-oauth"
import {
  discoverMcpServer as discoverMcp,
  discoverSavedOAuthMcpServer,
} from "@repo/lor/mcp-servers"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import {
  assertWorkspaceAuthority,
  hasWorkspaceAuthority,
  resolveWorkspaceAuthority,
} from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import {
  beginMcpOAuth,
  completeMcpOAuth,
  consumeMcpOAuthAttempt,
  disconnectMcpOAuth,
  findMcpOAuthCallbackContext,
  finishMcpOAuthCallback,
  McpOAuthServiceError,
  mcpOAuthSettingsUrl,
} from "@/routes/v1/mcp-servers/oauth-service"
import type {
  CompleteMcpServerOAuthRoute,
  CreateMcpServerRoute,
  DeleteMcpServerRoute,
  DisconnectMcpServerOAuthRoute,
  DiscoverMcpServerRoute,
  ListMcpServersRoute,
  McpServerOAuthCallbackRoute,
  RediscoverMcpServerRoute,
  StartMcpServerOAuthRoute,
  UpdateMcpServerRoute,
} from "@/routes/v1/mcp-servers/routes"

function oauthErrorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError"
}

function endpointHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "invalid"
  }
}

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
  const servers = await db
    .select({
      id: schema.mcpServer.id,
      workspaceId: schema.mcpServer.workspaceId,
      enabledTools: schema.mcpServer.enabledTools,
    })
    .from(schema.mcpServer)
    .where(inArray(schema.mcpServer.id, mcpServerIds))
  const workspaceIds = [...new Set(servers.map((server) => server.workspaceId))]
  if (workspaceIds.length === 0) return new Map()
  const profiles = await db
    .select({
      workspaceId: schema.agentProfile.workspaceId,
      access: schema.agentProfile.toolAccess,
    })
    .from(schema.agentProfile)
    .where(inArray(schema.agentProfile.workspaceId, workspaceIds))
  return new Map(
    servers.map((server) => [
      server.id,
      profiles.filter(
        (profile) =>
          profile.workspaceId === server.workspaceId &&
          profileSelectedTools(
            server.enabledTools,
            profile.access.mcpServers[server.id]
          ).length > 0
      ).length,
    ])
  )
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
  const revealHeaders = hasWorkspaceAuthority(c.var.authority, {
    customTool: ["manage"],
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
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
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
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
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

  const oauthResourceChanged =
    existing.authMode === "oauth" &&
    body.url !== undefined &&
    body.url !== existing.url
  const row = await db
    .transaction(async (tx) => {
      if (oauthResourceChanged) {
        await tx
          .delete(schema.mcpServerOAuthAttempt)
          .where(eq(schema.mcpServerOAuthAttempt.mcpServerId, existing.id))
      }
      return await tx
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
          ...(oauthResourceChanged
            ? {
                oauthStatus: "pending" as const,
                oauthCredentials: null,
                oauthAuthorizedBy: null,
                oauthAuthorizedAt: null,
                enabledTools: [],
              }
            : {}),
        })
        .where(eq(schema.mcpServer.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? null)
    })
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

export const startMcpServerOAuth: AppRouteHandler<
  StartMcpServerOAuthRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
  const { mcpServerId } = c.req.valid("param")

  try {
    const result = await beginMcpOAuth({
      mcpServerId,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      initiatedBy: c.var.user.id,
    })
    logger.info(
      {
        mcpServerId,
        workspaceId: workspace.id,
        oauthPhase: "start",
      },
      "MCP OAuth authorization started"
    )
    return c.json(result, HttpStatusCodes.OK)
  } catch (error) {
    logger.warn(
      {
        mcpServerId,
        workspaceId: workspace.id,
        oauthPhase: "start",
        errorClass: oauthErrorClass(error),
      },
      "MCP OAuth authorization start failed"
    )
    const status =
      error instanceof McpOAuthServiceError && error.code === "not_found"
        ? HttpStatusCodes.NOT_FOUND
        : HttpStatusCodes.BAD_REQUEST
    return c.json(
      {
        success: false as const,
        message:
          error instanceof McpOAuthServiceError
            ? error.message
            : "OAuth authorization could not be started",
      },
      status
    )
  }
}

export const mcpServerOAuthCallback: AppRouteHandler<
  McpServerOAuthCallbackRoute
> = async (c) => {
  const { workspaceSlug } = c.req.valid("param")
  const { code, state, error: providerError } = c.req.valid("query")
  const context = await findMcpOAuthCallbackContext(workspaceSlug, state)
  if (!context) {
    logger.warn(
      { oauthPhase: "callback", errorClass: "InvalidState" },
      "MCP OAuth callback rejected"
    )
    return c.redirect(
      mcpOAuthSettingsUrl(workspaceSlug),
      HttpStatusCodes.MOVED_TEMPORARILY
    )
  }
  const returnUrl = mcpOAuthSettingsUrl(workspaceSlug, context.server.id)

  const member = await db
    .select()
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, context.workspace.id),
        eq(schema.workspaceMember.userId, context.attempt.initiatedBy)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const logContext = {
    mcpServerId: context.server.id,
    workspaceId: context.workspace.id,
    endpointHost: endpointHost(context.server.url),
    oauthPhase: "callback",
  }
  if (
    !member ||
    !hasWorkspaceAuthority(
      await resolveWorkspaceAuthority(member, context.workspace),
      { customTool: ["manage"] }
    )
  ) {
    await consumeMcpOAuthAttempt(context, state).catch(() => {})
    logger.warn(
      { ...logContext, errorClass: "PermissionDenied" },
      "MCP OAuth callback rejected"
    )
    return c.redirect(returnUrl, HttpStatusCodes.MOVED_TEMPORARILY)
  }

  try {
    await consumeMcpOAuthAttempt(context, state)
    if (providerError || !code) {
      throw new McpOAuthServiceError(
        "upstream",
        "OAuth provider did not return an authorization code"
      )
    }
    await finishMcpOAuthCallback({
      context,
      workspaceSlug,
      code,
      state,
    })
    logger.info(logContext, "MCP OAuth callback completed")
  } catch (error) {
    logger.warn(
      { ...logContext, errorClass: oauthErrorClass(error) },
      "MCP OAuth callback failed"
    )
  }
  return c.redirect(returnUrl, HttpStatusCodes.MOVED_TEMPORARILY)
}

export const completeMcpServerOAuth: AppRouteHandler<
  CompleteMcpServerOAuthRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
  const { mcpServerId } = c.req.valid("param")
  const { enabledTools } = c.req.valid("json")
  const server = await db
    .select()
    .from(schema.mcpServer)
    .where(
      and(
        eq(schema.mcpServer.id, mcpServerId),
        eq(schema.mcpServer.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!server) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  try {
    const row = await completeMcpOAuth({
      server,
      workspaceSlug: workspace.slug,
      enabledTools,
    })
    const [counts, authorizers] = await Promise.all([
      grantCounts([row.id]),
      oauthAuthorizers([row.oauthAuthorizedBy]),
    ])
    logger.info(
      {
        mcpServerId: row.id,
        workspaceId: workspace.id,
        endpointHost: endpointHost(row.url),
        oauthPhase: "tool_review",
      },
      "MCP OAuth tools enabled"
    )
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
  } catch (error) {
    logger.warn(
      {
        mcpServerId,
        workspaceId: workspace.id,
        endpointHost: endpointHost(server.url),
        oauthPhase: "tool_review",
        errorClass: oauthErrorClass(error),
      },
      "MCP OAuth tool review failed"
    )
    return c.json(
      {
        success: false as const,
        message:
          error instanceof McpOAuthServiceError
            ? error.message
            : "OAuth tools could not be enabled",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
}

export const disconnectMcpServerOAuth: AppRouteHandler<
  DisconnectMcpServerOAuthRoute
> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
  const { mcpServerId } = c.req.valid("param")
  try {
    const row = await disconnectMcpOAuth({
      mcpServerId,
      workspaceId: workspace.id,
    })
    if (!row) {
      return c.json(
        { success: false, message: "Server not found" },
        HttpStatusCodes.NOT_FOUND
      )
    }
    const counts = await grantCounts([row.id])
    logger.info(
      {
        mcpServerId: row.id,
        workspaceId: workspace.id,
        endpointHost: endpointHost(row.url),
        oauthPhase: "disconnect",
      },
      "MCP OAuth disconnected"
    )
    return c.json(
      {
        server: toResponse(row, counts.get(row.id) ?? 0, true, null),
      },
      HttpStatusCodes.OK
    )
  } catch (error) {
    logger.warn(
      {
        mcpServerId,
        workspaceId: workspace.id,
        oauthPhase: "disconnect",
        errorClass: oauthErrorClass(error),
      },
      "MCP OAuth disconnect failed"
    )
    return c.json(
      {
        success: false as const,
        message:
          error instanceof McpOAuthServiceError
            ? error.message
            : "OAuth connection could not be disconnected",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
}

export const deleteMcpServer: AppRouteHandler<DeleteMcpServerRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
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
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
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
  assertWorkspaceAuthority(c.var.authority, { customTool: ["manage"] })
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
  if (existing.authMode === "oauth" && url !== existing.url) {
    return c.json(
      {
        success: false,
        message: "Save the new MCP URL before starting OAuth again",
      },
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
  const result =
    existing.authMode === "oauth"
      ? await discoverSavedOAuthMcpServer({
          server: {
            ...existing,
            headers: body.headers ?? existing.headers,
          },
          workspaceSlug: workspace.slug,
          headers,
          encryptionKey: key,
        })
      : await discoverMcp({ url, headers })
  if ("error" in result) {
    return c.json(
      { success: false, message: result.error },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  return c.json({ tools: result.tools }, HttpStatusCodes.OK)
}
