import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { logger } from "../logger"
import type { SourceProvider } from "./types"

const API_URL = "https://api.attio.com/v2"
const TOKEN_URL = "https://app.attio.com/oauth/token"
const INTROSPECT_URL = "https://app.attio.com/oauth/introspect"
const REQUEST_TIMEOUT_MS = 15_000

export const ATTIO_REQUIRED_READ_SCOPES = [
  "record_permission:read",
  "object_configuration:read",
  "list_configuration:read",
  "list_entry:read",
  "note:read",
  "task:read",
  "comment:read",
  "meeting:read",
  "call_recording:read",
  "file:read",
  "user_management:read",
] as const

type AttioIdentity = {
  active: boolean
  scope?: string
  exp?: number | null
  workspace_id?: string
  workspace_name?: string
  workspace_slug?: string
}

function encryptionKey(): string {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set; Attio is unavailable"
    )
  }
  return key
}

async function identifyToken(token: string): Promise<AttioIdentity | null> {
  try {
    const res = await fetch(INTROSPECT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.error({ status: res.status }, "Attio token introspection failed")
      return null
    }
    return (await res.json()) as AttioIdentity
  } catch (err) {
    logger.error({ err }, "Attio token introspection error")
    return null
  }
}

export function validateAttioReadScopes(scope: string | undefined): boolean {
  const scopes = new Set(scope?.split(/\s+/).filter(Boolean) ?? [])
  if ([...scopes].some((value) => value.endsWith(":read-write"))) return false
  return ATTIO_REQUIRED_READ_SCOPES.every((required) => scopes.has(required))
}

export async function connectAttio(
  code: string,
  redirectUri: string
): Promise<{
  externalId: string
  accountLabel: string | null
  accessToken: string
  tokenExpiresAt: Date | null
  scope: string
} | null> {
  if (!(env.ATTIO_CLIENT_ID && env.ATTIO_CLIENT_SECRET)) return null

  try {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: env.ATTIO_CLIENT_ID,
        client_secret: env.ATTIO_CLIENT_SECRET,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!tokenResponse.ok) {
      logger.error(
        { status: tokenResponse.status },
        "Attio token exchange failed"
      )
      return null
    }
    const tokenData = (await tokenResponse.json()) as { access_token?: string }
    if (!tokenData.access_token) return null

    const identity = await identifyToken(tokenData.access_token)
    if (
      !identity?.active ||
      !identity.workspace_id ||
      !validateAttioReadScopes(identity.scope)
    ) {
      logger.error(
        { scope: identity?.scope },
        "Attio token is inactive or does not have the exact read-only scope set"
      )
      return null
    }

    return {
      externalId: identity.workspace_id,
      accountLabel: identity.workspace_name ?? identity.workspace_slug ?? null,
      accessToken: encryptSecret(tokenData.access_token, encryptionKey()),
      tokenExpiresAt:
        typeof identity.exp === "number" ? new Date(identity.exp * 1000) : null,
      scope: identity.scope ?? "",
    }
  } catch (err) {
    logger.error({ err }, "Attio connection failed")
    return null
  }
}

export async function getAttioAccessToken(
  externalId: string
): Promise<string | null> {
  const row = await db
    .select({
      accessToken: schema.integrationConnection.accessToken,
      tokenExpiresAt: schema.integrationConnection.tokenExpiresAt,
    })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.provider, "attio"),
        eq(schema.integrationConnection.externalId, externalId),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!row?.accessToken) return null
  if (row.tokenExpiresAt && row.tokenExpiresAt.getTime() <= Date.now()) {
    return null
  }
  try {
    return decryptSecret(row.accessToken, encryptionKey())
  } catch {
    return null
  }
}

export async function attioRequest<T>(
  externalId: string,
  path: string,
  init?: RequestInit
): Promise<T | null> {
  const token = await getAttioAccessToken(externalId)
  if (!token) return null
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.warn({ path, status: res.status }, "Attio API request failed")
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    logger.warn({ err, path }, "Attio API request error")
    return null
  }
}

export const attioProvider: SourceProvider = {
  async fetchContent() {
    return null
  },

  async verifyConnection(connection) {
    const token = await getAttioAccessToken(connection.externalId)
    if (!token) return null
    const identity = await identifyToken(token)
    if (!identity?.active || identity.workspace_id !== connection.externalId) {
      return null
    }
    return {
      accountLabel: identity.workspace_name ?? identity.workspace_slug ?? null,
    }
  },
}
