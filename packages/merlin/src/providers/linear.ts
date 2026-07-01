import { LinearClient } from "@linear/sdk"
import { and, db, eq, schema, sql } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { logger } from "../logger"
import type { SourceProvider } from "./types"

const TOKEN_URL = "https://api.linear.app/oauth/token"
const MAX_COMMENTS = 10
// Refresh slightly before actual expiry to avoid racing the boundary.
const REFRESH_SKEW_MS = 60_000
const REQUEST_TIMEOUT_MS = 10_000

function encryptionKey(): string {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set; Linear is unavailable"
    )
  }
  return key
}

export type LinearTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  scope: string | null
}

async function requestTokens(
  body: Record<string, string>
): Promise<LinearTokens | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.error({ status: res.status }, "Linear token request failed")
      return null
    }
    const data = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
      scope?: string
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      scope: data.scope ?? null,
    }
  } catch (err) {
    logger.error({ err }, "Linear token request error")
    return null
  }
}

// Exchange an authorization code for tokens + resolve the org, so the connect
// handler can persist a ready-to-store, encrypted connection.
export async function connectLinear(
  code: string,
  redirectUri: string
): Promise<{
  externalId: string
  accountLabel: string | null
  accessToken: string
  refreshToken: string | null
  tokenExpiresAt: Date
  scope: string | null
} | null> {
  if (!(env.LINEAR_CLIENT_ID && env.LINEAR_CLIENT_SECRET)) return null
  const tokens = await requestTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: env.LINEAR_CLIENT_ID,
    client_secret: env.LINEAR_CLIENT_SECRET,
  })
  if (!tokens) return null

  const org = await new LinearClient({
    accessToken: tokens.accessToken,
  }).organization.catch(() => null)
  if (!org) return null

  const key = encryptionKey()
  return {
    externalId: org.id,
    accountLabel: org.name,
    accessToken: encryptSecret(tokens.accessToken, key),
    refreshToken: tokens.refreshToken
      ? encryptSecret(tokens.refreshToken, key)
      : null,
    tokenExpiresAt: tokens.expiresAt,
    scope: tokens.scope,
  }
}

const connectionColumns = {
  id: schema.integrationConnection.id,
  accessToken: schema.integrationConnection.accessToken,
  refreshToken: schema.integrationConnection.refreshToken,
  tokenExpiresAt: schema.integrationConnection.tokenExpiresAt,
}

const activeLinear = (externalId: string) =>
  and(
    eq(schema.integrationConnection.provider, "linear"),
    eq(schema.integrationConnection.externalId, externalId),
    eq(schema.integrationConnection.status, "active")
  )

function isFresh(expiresAt: Date | null): boolean {
  return !!expiresAt && expiresAt.getTime() - REFRESH_SKEW_MS > Date.now()
}

// Usable access token for the workspace's Linear org, refreshing + re-persisting
// when near expiry. Null when not connected, unconfigured, or refresh fails.
export async function getLinearAccessToken(
  externalId: string
): Promise<string | null> {
  const key = encryptionKey()
  const row = await db
    .select(connectionColumns)
    .from(schema.integrationConnection)
    .where(activeLinear(externalId))
    .limit(1)
    .then((r) => r[0])
  if (!row?.accessToken) return null

  // Fast path: still valid, no refresh needed.
  if (isFresh(row.tokenExpiresAt)) {
    try {
      return decryptSecret(row.accessToken, key)
    } catch {
      return null
    }
  }

  // Stale: serialize the refresh per org. Concurrent callers would each spend
  // the refresh token, and Linear rotates it on use — the losers would 401.
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`linear-refresh:${externalId}`}, 0))`
    )

    // Re-read under the lock: another caller may have refreshed already.
    const current = await tx
      .select(connectionColumns)
      .from(schema.integrationConnection)
      .where(activeLinear(externalId))
      .limit(1)
      .then((r) => r[0])
    if (!current?.accessToken) return null
    if (isFresh(current.tokenExpiresAt)) {
      try {
        return decryptSecret(current.accessToken, key)
      } catch {
        return null
      }
    }

    if (
      !(
        current.refreshToken &&
        env.LINEAR_CLIENT_ID &&
        env.LINEAR_CLIENT_SECRET
      )
    ) {
      return null
    }
    let refreshToken: string
    try {
      refreshToken = decryptSecret(current.refreshToken, key)
    } catch {
      return null
    }
    const tokens = await requestTokens({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.LINEAR_CLIENT_ID,
      client_secret: env.LINEAR_CLIENT_SECRET,
    })
    if (!tokens) return null

    await tx
      .update(schema.integrationConnection)
      .set({
        accessToken: encryptSecret(tokens.accessToken, key),
        refreshToken: tokens.refreshToken
          ? encryptSecret(tokens.refreshToken, key)
          : current.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        scope: tokens.scope,
      })
      .where(eq(schema.integrationConnection.id, current.id))
    return tokens.accessToken
  })
}

export async function linearClientFor(
  externalId: string
): Promise<LinearClient | null> {
  const token = await getLinearAccessToken(externalId)
  return token ? new LinearClient({ accessToken: token }) : null
}

function clip(s: string, max = 8000): string {
  return s.length > max ? `${s.slice(0, max)}\n…(truncated)` : s
}

export const linearProvider: SourceProvider = {
  async fetchContent(source, connection) {
    if (source.kind !== "issue") return null
    const client = await linearClientFor(connection.externalId)
    if (!client) return null
    const issue = await client.issue(source.externalId).catch(() => null)
    if (!issue) return null

    const state = await issue.state
    let out = `# ${issue.identifier} ${issue.title}\nState: ${state?.name ?? "unknown"}\n\n${issue.description ?? "(no description)"}`
    const comments = await issue
      .comments({ first: MAX_COMMENTS })
      .then((c) => c.nodes)
      .catch(() => [])
    for (const c of comments) {
      out += `\n\n— ${c.body}`
    }
    return clip(out)
  },

  async verifyConnection(connection) {
    const client = await linearClientFor(connection.externalId)
    if (!client) return null
    const org = await client.organization.catch(() => null)
    return org ? { accountLabel: org.name } : null
  },
}
