import { and, db, eq, inArray, isNull, schema } from "@repo/db"
import type { McpServer } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { createGuardedMcpFetch } from "./mcp-guarded-fetch"
import { DurableMcpOAuthProvider } from "./mcp-oauth-provider"

export class McpOAuthCredentialConflictError extends Error {
  constructor() {
    super("MCP OAuth credentials changed during this request")
    this.name = "McpOAuthCredentialConflictError"
  }
}

type RuntimeServer = Pick<
  McpServer,
  "id" | "workspaceId" | "url" | "headers" | "oauthCredentials" | "oauthStatus"
>

function callbackUrl(workspaceSlug: string): string {
  const apiOrigin = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "")
  const url = `${apiOrigin}/v1/workspaces/${encodeURIComponent(workspaceSlug)}/mcp-servers/oauth/callback`
  if (env.NODE_ENV === "production" && new URL(url).protocol !== "https:") {
    throw new Error("MCP OAuth callback URL must use HTTPS")
  }
  return url
}

export function createRuntimeMcpOAuthProvider(input: {
  server: RuntimeServer
  workspaceSlug: string
  encryptionKey: string
}) {
  let expectedCredentials = input.server.oauthCredentials
  const guardedFetch = createGuardedMcpFetch({
    resourceUrl: input.server.url,
    sensitiveHeaderNames: Object.keys(input.server.headers),
    // The outer MCP setup path remains capped at eight seconds. Established
    // tool calls retain the SDK's longer request window.
    timeoutMs: 60_000,
  })
  const provider = new DurableMcpOAuthProvider({
    mode: "noninteractive",
    server: input.server,
    encryptionKey: input.encryptionKey,
    redirectUrl: callbackUrl(input.workspaceSlug),
    guardedFetch,
    saveCredentials: async (oauthCredentials) => {
      const row = await db
        .update(schema.mcpServer)
        .set({
          oauthCredentials,
          ...(oauthCredentials === null
            ? { oauthStatus: "reauthorization_required" as const }
            : {}),
        })
        .where(
          and(
            eq(schema.mcpServer.id, input.server.id),
            eq(schema.mcpServer.workspaceId, input.server.workspaceId),
            eq(schema.mcpServer.authMode, "oauth"),
            expectedCredentials
              ? eq(schema.mcpServer.oauthCredentials, expectedCredentials)
              : isNull(schema.mcpServer.oauthCredentials)
          )
        )
        .returning({ id: schema.mcpServer.id })
        .then((rows) => rows[0] ?? null)
      if (!row) throw new McpOAuthCredentialConflictError()
      expectedCredentials = oauthCredentials
    },
    onInteractionRequired: async () => {
      await db
        .update(schema.mcpServer)
        .set({ oauthStatus: "reauthorization_required" })
        .where(
          and(
            eq(schema.mcpServer.id, input.server.id),
            eq(schema.mcpServer.workspaceId, input.server.workspaceId),
            eq(schema.mcpServer.authMode, "oauth"),
            inArray(schema.mcpServer.oauthStatus, [
              "needs_tool_review",
              "connected",
            ]),
            expectedCredentials
              ? eq(schema.mcpServer.oauthCredentials, expectedCredentials)
              : isNull(schema.mcpServer.oauthCredentials)
          )
        )
    },
  })
  return {
    provider,
    guardedFetch,
    credentialsSnapshot: () => expectedCredentials,
  }
}
