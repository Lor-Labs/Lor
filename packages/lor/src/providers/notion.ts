import {
  APIErrorCode,
  Client,
  isHTTPResponseError,
  isNotionClientError,
  type OauthTokenParameters,
  type OauthTokenResponse,
} from "@notionhq/client"
import { and, db, eq, schema, sql } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { logger } from "../logger"
import type { SourceProvider } from "./types"

export const NOTION_API_VERSION = "2026-03-11"
export const NOTION_REQUIRED_CAPABILITIES = [
  "Read content",
  "Read comments",
  "User information without email addresses",
] as const

const REQUEST_TIMEOUT_MS = 15_000
// Only read permissions are verified at connect time; writes are enforced by Notion.
const STORED_SCOPE = "read_content read_comments read_user_without_email"

type NotionTokens = Pick<
  OauthTokenResponse,
  | "access_token"
  | "refresh_token"
  | "bot_id"
  | "workspace_id"
  | "workspace_name"
>

type TokenResult = {
  tokens: NotionTokens | null
  permanentFailure: boolean
}

const connectionColumns = {
  id: schema.integrationConnection.id,
  accessToken: schema.integrationConnection.accessToken,
  refreshToken: schema.integrationConnection.refreshToken,
}

const activeNotion = (externalId: string) =>
  and(
    eq(schema.integrationConnection.provider, "notion"),
    eq(schema.integrationConnection.externalId, externalId),
    eq(schema.integrationConnection.status, "active")
  )

function encryptionKey(): string {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set; Notion is unavailable"
    )
  }
  return key
}

function oauthClient(): Client {
  return new Client({
    notionVersion: NOTION_API_VERSION,
    timeoutMs: REQUEST_TIMEOUT_MS,
    retry: false,
  })
}

function authenticatedClient(accessToken: string, write = false): Client {
  return new Client({
    auth: accessToken,
    ...(write ? { retry: false as const } : {}),
    notionVersion: NOTION_API_VERSION,
    timeoutMs: REQUEST_TIMEOUT_MS,
  })
}

function isUnauthorized(error: unknown): boolean {
  return isNotionClientError(error) && error.code === APIErrorCode.Unauthorized
}

async function requestTokens(
  params: OauthTokenParameters
): Promise<TokenResult> {
  if (!(env.NOTION_CLIENT_ID && env.NOTION_CLIENT_SECRET)) {
    return { tokens: null, permanentFailure: true }
  }
  try {
    const response = await oauthClient().oauth.token({
      ...params,
      client_id: env.NOTION_CLIENT_ID,
      client_secret: env.NOTION_CLIENT_SECRET,
    })
    return { tokens: response, permanentFailure: false }
  } catch (error) {
    const permanentFailure =
      isHTTPResponseError(error) && [400, 401, 403].includes(error.status)
    logger.error(
      {
        error,
        permanentFailure,
        grantType: params.grant_type,
      },
      "Notion token request failed"
    )
    return { tokens: null, permanentFailure }
  }
}

function exposesUserEmails(value: unknown): boolean {
  if (!(value && typeof value === "object" && "results" in value)) return false
  const results = (value as { results?: unknown }).results
  if (!Array.isArray(results)) return false
  return results.some((user) => {
    if (!(user && typeof user === "object" && "person" in user)) return false
    const person = (user as { person?: unknown }).person
    return !!(
      person &&
      typeof person === "object" &&
      "email" in person &&
      typeof (person as { email?: unknown }).email === "string"
    )
  })
}

export async function connectNotion(
  code: string,
  redirectUri: string
): Promise<{
  externalId: string
  providerWorkspaceId: string
  accountLabel: string | null
  accessToken: string
  refreshToken: string | null
  scope: string
} | null> {
  const result = await requestTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  })
  if (!result.tokens) return null

  const client = authenticatedClient(result.tokens.access_token)
  try {
    // Notion capabilities are configured in the Developer portal, not on the
    // authorize URL. Search and users verify their read capabilities; when the
    // page picker returned a page, a comments request verifies Read comments.
    const [search, users] = await Promise.all([
      client.search({
        page_size: 1,
        filter: { property: "object", value: "page", in_trash: false },
      }),
      client.users.list({ page_size: 1 }),
    ])
    const readablePage = search.results.find(
      (result) => result.object === "page"
    )
    if (readablePage) {
      await client.comments.list({ block_id: readablePage.id, page_size: 1 })
    }
    // Selecting "without email addresses" must not leak email-bearing user
    // objects even if the portal was accidentally configured too broadly.
    if (exposesUserEmails(users)) {
      logger.error("Notion connection exposes user email addresses")
      return null
    }
  } catch (error) {
    logger.error({ error }, "Notion connection capability check failed")
    return null
  }

  const key = encryptionKey()
  return {
    externalId: result.tokens.bot_id,
    providerWorkspaceId: result.tokens.workspace_id,
    accountLabel: result.tokens.workspace_name,
    accessToken: encryptSecret(result.tokens.access_token, key),
    refreshToken: result.tokens.refresh_token
      ? encryptSecret(result.tokens.refresh_token, key)
      : null,
    scope: STORED_SCOPE,
  }
}

export async function getNotionAccessToken(
  externalId: string
): Promise<string | null> {
  const row = await db
    .select(connectionColumns)
    .from(schema.integrationConnection)
    .where(activeNotion(externalId))
    .limit(1)
    .then((rows) => rows[0])
  if (!row?.accessToken) return null
  try {
    return decryptSecret(row.accessToken, encryptionKey())
  } catch (error) {
    // Deliberately not revoked: this usually means INTEGRATION_ENCRYPTION_KEY
    // is misconfigured, and redeploying the right key restores service —
    // revoking would wipe the stored tokens irrecoverably.
    logger.error(
      { error, externalId },
      "Notion access token could not be decrypted"
    )
    return null
  }
}

async function revokeNotionConnection(externalId: string): Promise<void> {
  await db
    .update(schema.integrationConnection)
    .set({
      status: "revoked",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      scope: null,
    })
    .where(activeNotion(externalId))
}

async function refreshNotionAccessToken(
  externalId: string,
  rejectedAccessToken: string
): Promise<{ token: string | null; permanentFailure: boolean }> {
  const key = encryptionKey()
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`notion-refresh:${externalId}`}, 0))`
    )

    const current = await tx
      .select(connectionColumns)
      .from(schema.integrationConnection)
      .where(activeNotion(externalId))
      .limit(1)
      .then((rows) => rows[0])
    if (!(current?.accessToken && current.refreshToken)) {
      return { token: null, permanentFailure: true }
    }

    let accessToken: string
    let refreshToken: string
    try {
      accessToken = decryptSecret(current.accessToken, key)
      refreshToken = decryptSecret(current.refreshToken, key)
    } catch {
      return { token: null, permanentFailure: true }
    }

    // Another caller may already have rotated the token while this caller was
    // waiting for the lock. Reuse that result instead of spending it again.
    if (accessToken !== rejectedAccessToken) {
      return { token: accessToken, permanentFailure: false }
    }

    const result = await requestTokens({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
    if (!result.tokens) {
      return { token: null, permanentFailure: result.permanentFailure }
    }

    await tx
      .update(schema.integrationConnection)
      .set({
        accessToken: encryptSecret(result.tokens.access_token, key),
        refreshToken: result.tokens.refresh_token
          ? encryptSecret(result.tokens.refresh_token, key)
          : current.refreshToken,
      })
      .where(eq(schema.integrationConnection.id, current.id))
    return { token: result.tokens.access_token, permanentFailure: false }
  })
}

export async function notionCall<T>(
  externalId: string,
  operation: (client: Client) => Promise<T>
): Promise<T | null> {
  const accessToken = await getNotionAccessToken(externalId)
  if (!accessToken) return null
  try {
    return await operation(authenticatedClient(accessToken))
  } catch (error) {
    if (!isUnauthorized(error)) {
      logger.warn({ error }, "Notion API request failed")
      return null
    }
  }

  const refreshed = await refreshNotionAccessToken(externalId, accessToken)
  if (!refreshed.token) {
    if (refreshed.permanentFailure) {
      await revokeNotionConnection(externalId)
    }
    return null
  }

  try {
    return await operation(authenticatedClient(refreshed.token))
  } catch (error) {
    if (isUnauthorized(error)) {
      await revokeNotionConnection(externalId)
    } else {
      logger.warn({ error }, "Notion API retry failed")
    }
    return null
  }
}

export type NotionWriteResult<T> =
  | { data: T }
  | {
      error: string
      outcome: "failed" | "unknown"
      requiresReconnection?: boolean
    }

function notionWriteFailure(
  error: unknown
): Exclude<NotionWriteResult<never>, { data: never }> {
  const status = isHTTPResponseError(error) ? error.status : null
  const code = isNotionClientError(error) ? error.code : "unknown"
  logger.warn({ status, code }, "Notion write request failed")
  if (status === 401 || status === 403)
    return {
      error:
        "Notion denied this write. Enable the required content or comment permissions in the Notion connection settings, reconnect Notion in Lor, and check access to the target page.",
      outcome: "failed",
      requiresReconnection: true,
    }
  if (status !== null && status >= 400 && status < 500 && status !== 408)
    return {
      error: isNotionClientError(error)
        ? error.message.slice(0, 1000)
        : "Notion rejected the write",
      outcome: "failed",
    }
  return {
    error:
      "Notion did not confirm whether this write completed. Check the page or discussion before making another write; do not automatically repeat this action.",
    outcome: "unknown",
  }
}

// Each operation performs one mutation. Only a rejected 401 may refresh and retry;
// timeouts and server errors can occur after a write, so never replay them here.
export async function notionWriteCall<T>(
  externalId: string,
  operation: (client: Client) => Promise<T>
): Promise<NotionWriteResult<T>> {
  const token = await getNotionAccessToken(externalId)
  if (!token)
    return {
      error: "Reconnect Notion before writing.",
      outcome: "failed",
      requiresReconnection: true,
    }
  try {
    return { data: await operation(authenticatedClient(token, true)) }
  } catch (error) {
    if (!isUnauthorized(error)) return notionWriteFailure(error)
  }
  const refreshed = await refreshNotionAccessToken(externalId, token)
  if (!refreshed.token) {
    if (refreshed.permanentFailure) await revokeNotionConnection(externalId)
    return {
      error:
        "Notion authorization could not be refreshed. Reconnect Notion before writing.",
      outcome: "failed",
      requiresReconnection: true,
    }
  }
  try {
    return { data: await operation(authenticatedClient(refreshed.token, true)) }
  } catch (error) {
    if (isUnauthorized(error)) await revokeNotionConnection(externalId)
    return notionWriteFailure(error)
  }
}

export const notionProvider: SourceProvider = {
  async verifyConnection(connection) {
    const bot = await notionCall(connection.externalId, (client) =>
      client.users.me({})
    )
    return bot ? { accountLabel: null } : null
  },
}
