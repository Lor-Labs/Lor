import { createHash } from "node:crypto"
import { BETTERSTACK_TOOLS } from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { connectMcpServer } from "../mcp-servers"
import type { SourceProvider } from "./types"

export const BETTERSTACK_MCP_URL = "https://mcp.betterstack.com"

export function betterstackHeaders(
  token: string,
  upstreamNames: readonly string[]
) {
  return {
    Authorization: `Bearer ${token}`,
    "X-MCP-Tools-Only": upstreamNames.join(","),
  }
}

async function verifyToken(token: string): Promise<boolean> {
  const session = await connectMcpServer({
    url: BETTERSTACK_MCP_URL,
    headers: betterstackHeaders(
      token,
      BETTERSTACK_TOOLS.filter((tool) => tool.readOnlyHint).map(
        (tool) => tool.upstreamName
      )
    ),
  })
  try {
    return session.discovered.some((tool) =>
      BETTERSTACK_TOOLS.some(
        (known) => known.readOnlyHint && known.upstreamName === tool.name
      )
    )
  } finally {
    await session.client.close().catch(() => {})
  }
}

export async function connectBetterstack(token: string): Promise<{
  externalId: string
  accountLabel: string
  apiKey: string
} | null> {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key || !(await verifyToken(token))) return null
  return {
    externalId: createHash("sha256").update(token).digest("hex"),
    accountLabel: "Better Stack account",
    apiKey: encryptSecret(token, key),
  }
}

export async function getBetterstackConnection(workspaceId: string) {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return null
  const row = await db
    .select({
      apiKey: schema.integrationConnection.apiKey,
      enabledTools: schema.integrationConnection.enabledTools,
    })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.workspaceId, workspaceId),
        eq(schema.integrationConnection.provider, "betterstack"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!row?.apiKey) return null
  return {
    token: decryptSecret(row.apiKey, key),
    enabledTools: row.enabledTools,
  }
}

export const betterstackProvider: SourceProvider = {
  async fetchContent() {
    return null
  },
  async verifyConnection(connection) {
    const key = env.INTEGRATION_ENCRYPTION_KEY
    if (!key) return null
    const row = await db
      .select({ apiKey: schema.integrationConnection.apiKey })
      .from(schema.integrationConnection)
      .where(
        and(
          eq(schema.integrationConnection.provider, "betterstack"),
          eq(schema.integrationConnection.externalId, connection.externalId),
          eq(schema.integrationConnection.status, "active")
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (!row?.apiKey) return null
    return (await verifyToken(decryptSecret(row.apiKey, key)))
      ? { accountLabel: "Better Stack account" }
      : null
  },
}
