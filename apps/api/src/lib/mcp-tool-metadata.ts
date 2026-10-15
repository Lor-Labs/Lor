import { and, db, eq, isNull, schema } from "@repo/db"
import type { McpServer, McpToolMetadata } from "@repo/db/schema"
import { renderTemplate } from "@repo/lor/custom-tools"
import { discoverMcpServer } from "@repo/lor/mcp-servers"
import { decryptSecret } from "@repo/utils/crypto"
import { logger } from "./logger"

export function enabledMcpToolMetadata(
  tools: readonly McpToolMetadata[],
  enabledTools: readonly string[]
): McpToolMetadata[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  return [...new Set(enabledTools)].flatMap((name) => {
    const tool = byName.get(name)
    if (!tool) return []
    return [
      {
        name,
        description: tool.description.slice(0, 1000),
        ...(typeof tool.readOnlyHint === "boolean"
          ? { readOnlyHint: tool.readOnlyHint }
          : {}),
      },
    ]
  })
}

// Token refresh may rotate credentials within the same authorization. Account
// changes, endpoint edits, and concurrent tool-selection changes invalidate this snapshot.
export function mcpMetadataSnapshotWhere(server: McpServer) {
  return and(
    eq(schema.mcpServer.id, server.id),
    eq(schema.mcpServer.workspaceId, server.workspaceId),
    eq(schema.mcpServer.authMode, server.authMode),
    eq(schema.mcpServer.url, server.url),
    eq(schema.mcpServer.headers, server.headers),
    eq(schema.mcpServer.secrets, server.secrets),
    eq(schema.mcpServer.enabledTools, server.enabledTools),
    server.oauthStatus === null
      ? isNull(schema.mcpServer.oauthStatus)
      : eq(schema.mcpServer.oauthStatus, server.oauthStatus),
    server.oauthAuthorizedBy === null
      ? isNull(schema.mcpServer.oauthAuthorizedBy)
      : eq(schema.mcpServer.oauthAuthorizedBy, server.oauthAuthorizedBy),
    server.oauthAuthorizedAt === null
      ? isNull(schema.mcpServer.oauthAuthorizedAt)
      : eq(schema.mcpServer.oauthAuthorizedAt, server.oauthAuthorizedAt)
  )
}

export async function cacheMcpToolMetadata(
  server: McpServer,
  tools: readonly McpToolMetadata[]
) {
  await db
    .update(schema.mcpServer)
    .set({ toolMetadata: enabledMcpToolMetadata(tools, server.enabledTools) })
    .where(mcpMetadataSnapshotWhere(server))
}

export async function discoverStaticMcpToolMetadata(
  server: Pick<McpServer, "url" | "headers" | "secrets" | "enabledTools">,
  encryptionKey: string
): Promise<McpToolMetadata[]> {
  try {
    const secrets = Object.fromEntries(
      Object.entries(server.secrets).map(([name, value]) => [
        name,
        decryptSecret(value, encryptionKey),
      ])
    )
    const headers = Object.fromEntries(
      Object.entries(server.headers).map(([name, value]) => [
        name,
        renderTemplate(value, "header", {}, secrets),
      ])
    )
    const result = await discoverMcpServer({ url: server.url, headers })
    return "tools" in result
      ? enabledMcpToolMetadata(result.tools, server.enabledTools)
      : []
  } catch {
    // Metadata is optional display data; an unavailable provider must not block config saves.
    logger.warn("MCP tool metadata could not be refreshed")
    return []
  }
}

export function sameMcpHeaders(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([name, value]) => right[name] === value)
  )
}
