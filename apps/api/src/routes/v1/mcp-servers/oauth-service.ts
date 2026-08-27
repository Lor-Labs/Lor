import { and, db, eq, exists, isNull, schema, sql } from "@repo/db"
import type { McpServer, McpServerOAuthAttempt } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { renderTemplate } from "@repo/merlin/custom-tools"
import { createGuardedMcpFetch } from "@repo/merlin/mcp-guarded-fetch"
import {
  DurableMcpOAuthProvider,
  discoverAuthorizedMcpTools,
  exchangeMcpOAuthAuthorization,
  startMcpOAuthAuthorization,
} from "@repo/merlin/mcp-oauth-provider"
import { createRuntimeMcpOAuthProvider } from "@repo/merlin/mcp-runtime-oauth"
import {
  createMcpOAuthState,
  decryptMcpOAuthCredentials,
  encryptMcpOAuthCredentials,
  hashMcpOAuthState,
  mcpOAuthAttemptExpiresAt,
  validateMcpOAuthAttempt,
} from "@repo/merlin/mcp-server-oauth"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"

export class McpOAuthServiceError extends Error {
  constructor(
    readonly code:
      | "configuration"
      | "invalid_state"
      | "not_found"
      | "not_oauth"
      | "wrong_status"
      | "upstream",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "McpOAuthServiceError"
  }
}

function encryptionKey(): string {
  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    throw new McpOAuthServiceError("configuration", "MCP OAuth is unavailable")
  }
  return env.INTEGRATION_ENCRYPTION_KEY
}

export function mcpOAuthCallbackUrl(workspaceSlug: string): string {
  const apiOrigin = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "")
  const callbackUrl = `${apiOrigin}/v1/workspaces/${encodeURIComponent(workspaceSlug)}/mcp-servers/oauth/callback`
  if (
    env.NODE_ENV === "production" &&
    new URL(callbackUrl).protocol !== "https:"
  ) {
    throw new McpOAuthServiceError(
      "configuration",
      "MCP OAuth callback URL must use HTTPS"
    )
  }
  return callbackUrl
}

export function mcpOAuthSettingsUrl(
  workspaceSlug: string,
  mcpServerId?: string
): string {
  const url = new URL(
    `${env.APP_BASE_URL.replace(/\/+$/, "")}/${encodeURIComponent(workspaceSlug)}`
  )
  url.searchParams.set("settings", "workspace")
  url.searchParams.set("tab", "custom-tools")
  if (mcpServerId) url.searchParams.set("mcpServerId", mcpServerId)
  return url.href
}

function credentialsWithoutTokens(
  ciphertext: string | null,
  key: string
): string | null {
  if (!ciphertext) return null
  const credentials = decryptMcpOAuthCredentials(ciphertext, key)
  const { tokens: _tokens, ...remaining } = credentials
  if (
    !remaining.clientInformation &&
    !remaining.authorizationServerInformation
  ) {
    return null
  }
  return encryptMcpOAuthCredentials(remaining, key)
}

function renderedServerHeaders(
  server: Pick<McpServer, "headers" | "secrets">,
  key: string
): Record<string, string> {
  const secrets = Object.fromEntries(
    Object.entries(server.secrets).map(([name, ciphertext]) => [
      name,
      decryptSecret(ciphertext, key),
    ])
  )
  return Object.fromEntries(
    Object.entries(server.headers).map(([name, template]) => [
      name,
      renderTemplate(template, "header", {}, secrets),
    ])
  )
}

function providerFor(input: {
  mode: "start" | "callback"
  server: McpServer
  attempt?: McpServerOAuthAttempt
  workspaceSlug: string
}) {
  const key = encryptionKey()
  const attemptId = input.attempt?.id
  const guardedFetch = createGuardedMcpFetch({
    resourceUrl: input.server.url,
    sensitiveHeaderNames: Object.keys(input.server.headers),
  })
  const provider = new DurableMcpOAuthProvider({
    mode: input.mode,
    server: input.server,
    attempt: input.attempt,
    encryptionKey: key,
    redirectUrl: mcpOAuthCallbackUrl(input.workspaceSlug),
    guardedFetch,
    saveCredentials: async (oauthCredentials) => {
      const row = await db
        .update(schema.mcpServer)
        .set({ oauthCredentials })
        .where(
          and(
            eq(schema.mcpServer.id, input.server.id),
            eq(schema.mcpServer.workspaceId, input.server.workspaceId),
            attemptId
              ? exists(
                  db
                    .select({ value: sql`1` })
                    .from(schema.mcpServerOAuthAttempt)
                    .where(eq(schema.mcpServerOAuthAttempt.id, attemptId))
                )
              : input.server.oauthCredentials
                ? eq(
                    schema.mcpServer.oauthCredentials,
                    input.server.oauthCredentials
                  )
                : isNull(schema.mcpServer.oauthCredentials)
          )
        )
        .returning({ id: schema.mcpServer.id })
        .then((rows) => rows[0] ?? null)
      if (!row) throw new Error("OAuth server state changed")
    },
    saveAttemptState: attemptId
      ? async ({ stateHash, encryptedState }) => {
          await db
            .update(schema.mcpServerOAuthAttempt)
            .set({ stateHash, encryptedState })
            .where(eq(schema.mcpServerOAuthAttempt.id, attemptId))
        }
      : undefined,
    saveAttemptCodeVerifier: attemptId
      ? async (encryptedCodeVerifier) => {
          await db
            .update(schema.mcpServerOAuthAttempt)
            .set({ encryptedCodeVerifier })
            .where(eq(schema.mcpServerOAuthAttempt.id, attemptId))
        }
      : undefined,
  })
  return { provider, guardedFetch, key }
}

export async function beginMcpOAuth(input: {
  mcpServerId: string
  workspaceId: string
  workspaceSlug: string
  initiatedBy: string
}): Promise<{ authorizationUrl: string }> {
  const key = encryptionKey()
  const state = createMcpOAuthState()
  const prepared = await db.transaction(async (tx) => {
    const server = await tx
      .select()
      .from(schema.mcpServer)
      .where(
        and(
          eq(schema.mcpServer.id, input.mcpServerId),
          eq(schema.mcpServer.workspaceId, input.workspaceId)
        )
      )
      .limit(1)
      .for("update")
      .then((rows) => rows[0] ?? null)
    if (!server) {
      throw new McpOAuthServiceError("not_found", "Server not found")
    }
    if (server.authMode !== "oauth") {
      throw new McpOAuthServiceError("not_oauth", "Server does not use OAuth")
    }

    await tx
      .delete(schema.mcpServerOAuthAttempt)
      .where(eq(schema.mcpServerOAuthAttempt.mcpServerId, server.id))
    const oauthCredentials = credentialsWithoutTokens(
      server.oauthCredentials,
      key
    )
    const updatedServer = await tx
      .update(schema.mcpServer)
      .set({
        oauthStatus: "pending",
        oauthCredentials,
        oauthAuthorizedBy: null,
        oauthAuthorizedAt: null,
      })
      .where(eq(schema.mcpServer.id, server.id))
      .returning()
      .then((rows) => rows[0] ?? null)
    const attempt = await tx
      .insert(schema.mcpServerOAuthAttempt)
      .values({
        mcpServerId: server.id,
        workspaceId: server.workspaceId,
        initiatedBy: input.initiatedBy,
        stateHash: hashMcpOAuthState(state),
        encryptedState: encryptSecret(state, key),
        encryptedCodeVerifier: encryptSecret("pending", key),
        expiresAt: mcpOAuthAttemptExpiresAt(),
      })
      .returning()
      .then((rows) => rows[0] ?? null)
    if (!(updatedServer && attempt)) {
      throw new McpOAuthServiceError(
        "configuration",
        "OAuth attempt could not be persisted"
      )
    }
    return { server: updatedServer, attempt }
  })

  const { provider, guardedFetch } = providerFor({
    mode: "start",
    server: prepared.server,
    attempt: prepared.attempt,
    workspaceSlug: input.workspaceSlug,
  })
  try {
    const authorizationUrl = await startMcpOAuthAuthorization({
      provider,
      serverUrl: prepared.server.url,
      guardedFetch,
    })
    return { authorizationUrl }
  } catch (cause) {
    await db
      .delete(schema.mcpServerOAuthAttempt)
      .where(eq(schema.mcpServerOAuthAttempt.id, prepared.attempt.id))
    throw new McpOAuthServiceError(
      "upstream",
      "The MCP server could not begin OAuth authorization",
      { cause }
    )
  }
}

export type McpOAuthCallbackContext = {
  attempt: McpServerOAuthAttempt
  server: McpServer
  workspace: typeof schema.workspace.$inferSelect
}

export async function findMcpOAuthCallbackContext(
  workspaceSlug: string,
  state: string
): Promise<McpOAuthCallbackContext | null> {
  return await db
    .select({
      attempt: schema.mcpServerOAuthAttempt,
      server: schema.mcpServer,
      workspace: schema.workspace,
    })
    .from(schema.mcpServerOAuthAttempt)
    .innerJoin(
      schema.mcpServer,
      eq(schema.mcpServer.id, schema.mcpServerOAuthAttempt.mcpServerId)
    )
    .innerJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.mcpServerOAuthAttempt.workspaceId)
    )
    .where(
      and(
        eq(schema.mcpServerOAuthAttempt.stateHash, hashMcpOAuthState(state)),
        eq(schema.workspace.slug, workspaceSlug),
        eq(schema.mcpServer.authMode, "oauth"),
        eq(
          schema.mcpServer.workspaceId,
          schema.mcpServerOAuthAttempt.workspaceId
        )
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export async function consumeMcpOAuthAttempt(
  context: McpOAuthCallbackContext,
  state: string
): Promise<void> {
  const consumed = await db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(schema.mcpServerOAuthAttempt)
      .where(eq(schema.mcpServerOAuthAttempt.id, context.attempt.id))
      .limit(1)
      .for("update")
      .then((rows) => rows[0] ?? null)
    if (!current || !validateMcpOAuthAttempt(current, state).ok) return false
    const row = await tx
      .update(schema.mcpServerOAuthAttempt)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(schema.mcpServerOAuthAttempt.id, current.id),
          isNull(schema.mcpServerOAuthAttempt.consumedAt)
        )
      )
      .returning({ id: schema.mcpServerOAuthAttempt.id })
      .then((rows) => rows[0] ?? null)
    return Boolean(row)
  })
  if (!consumed) {
    throw new McpOAuthServiceError(
      "invalid_state",
      "OAuth attempt is invalid or expired"
    )
  }
}

export async function finishMcpOAuthCallback(input: {
  context: McpOAuthCallbackContext
  workspaceSlug: string
  code: string
  state: string
}): Promise<void> {
  const { provider, guardedFetch } = providerFor({
    mode: "callback",
    server: input.context.server,
    attempt: input.context.attempt,
    workspaceSlug: input.workspaceSlug,
  })
  try {
    await exchangeMcpOAuthAuthorization({
      provider,
      serverUrl: input.context.server.url,
      authorizationCode: input.code,
      callbackState: input.state,
      guardedFetch,
    })
    const updated = await db
      .update(schema.mcpServer)
      .set({
        oauthStatus: "needs_tool_review",
        oauthAuthorizedBy: input.context.attempt.initiatedBy,
        oauthAuthorizedAt: new Date(),
      })
      .where(
        and(
          eq(schema.mcpServer.id, input.context.server.id),
          eq(schema.mcpServer.workspaceId, input.context.server.workspaceId),
          exists(
            db
              .select({ value: sql`1` })
              .from(schema.mcpServerOAuthAttempt)
              .where(
                eq(schema.mcpServerOAuthAttempt.id, input.context.attempt.id)
              )
          )
        )
      )
      .returning({ id: schema.mcpServer.id })
      .then((rows) => rows[0] ?? null)
    if (!updated) throw new Error("OAuth server state changed")
    await db
      .delete(schema.mcpServerOAuthAttempt)
      .where(eq(schema.mcpServerOAuthAttempt.id, input.context.attempt.id))
  } catch (cause) {
    throw new McpOAuthServiceError(
      "upstream",
      "OAuth authorization could not be completed",
      { cause }
    )
  }
}

export async function completeMcpOAuth(input: {
  server: McpServer
  workspaceSlug: string
  enabledTools: string[]
}): Promise<McpServer> {
  if (
    input.server.authMode !== "oauth" ||
    (input.server.oauthStatus !== "needs_tool_review" &&
      input.server.oauthStatus !== "connected") ||
    !input.server.oauthCredentials
  ) {
    throw new McpOAuthServiceError(
      "wrong_status",
      "Server is not ready for tool review"
    )
  }
  const expectedStatus = input.server.oauthStatus
  const key = encryptionKey()
  const { provider, guardedFetch, credentialsSnapshot } =
    createRuntimeMcpOAuthProvider({
      server: input.server,
      workspaceSlug: input.workspaceSlug,
      encryptionKey: key,
    })
  let tools: { name: string }[]
  try {
    tools = await discoverAuthorizedMcpTools({
      provider,
      serverUrl: input.server.url,
      headers: renderedServerHeaders(input.server, key),
      guardedFetch,
    })
  } catch (cause) {
    throw new McpOAuthServiceError(
      "upstream",
      "The MCP server tools could not be verified",
      { cause }
    )
  }
  const available = new Set(tools.map((tool) => tool.name))
  if (input.enabledTools.some((tool) => !available.has(tool))) {
    throw new McpOAuthServiceError(
      "wrong_status",
      "Enabled tools must be selected from the current server tool list"
    )
  }
  const verifiedCredentials = credentialsSnapshot()
  const row = await db
    .update(schema.mcpServer)
    .set({ oauthStatus: "connected", enabledTools: input.enabledTools })
    .where(
      and(
        eq(schema.mcpServer.id, input.server.id),
        eq(schema.mcpServer.workspaceId, input.server.workspaceId),
        eq(schema.mcpServer.oauthStatus, expectedStatus),
        verifiedCredentials
          ? eq(schema.mcpServer.oauthCredentials, verifiedCredentials)
          : isNull(schema.mcpServer.oauthCredentials)
      )
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!row) {
    throw new McpOAuthServiceError(
      "wrong_status",
      "Server authorization state changed"
    )
  }
  return row
}

export async function disconnectMcpOAuth(input: {
  mcpServerId: string
  workspaceId: string
}): Promise<McpServer | null> {
  return await db.transaction(async (tx) => {
    const server = await tx
      .select()
      .from(schema.mcpServer)
      .where(
        and(
          eq(schema.mcpServer.id, input.mcpServerId),
          eq(schema.mcpServer.workspaceId, input.workspaceId)
        )
      )
      .limit(1)
      .for("update")
      .then((rows) => rows[0] ?? null)
    if (!server) return null
    if (server.authMode !== "oauth") {
      throw new McpOAuthServiceError("not_oauth", "Server does not use OAuth")
    }
    await tx
      .delete(schema.mcpServerOAuthAttempt)
      .where(eq(schema.mcpServerOAuthAttempt.mcpServerId, server.id))
    return await tx
      .update(schema.mcpServer)
      .set({
        oauthStatus: "pending",
        oauthCredentials: null,
        oauthAuthorizedBy: null,
        oauthAuthorizedAt: null,
        enabledTools: [],
      })
      .where(eq(schema.mcpServer.id, server.id))
      .returning()
      .then((rows) => rows[0] ?? null)
  })
}
