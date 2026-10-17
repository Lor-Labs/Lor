import { LinearClient } from "@linear/sdk"
import { linearIssueKey } from "@repo/connectors"
import { and, db, eq, schema, sql } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { logger } from "../logger"
import type { SourceFetcher, SourceProvider } from "./types"

const TOKEN_URL = "https://api.linear.app/oauth/token"
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

// One query for the issue and its discussion. A filter (not issue(id:)) so a
// missing issue is an empty list, not an error; archived and trashed issues
// still match.
const INGEST_ISSUE_QUERY = `query LorIngestIssue($filter: IssueFilter!) {
  issues(filter: $filter, first: 1, includeArchived: true) {
    nodes {
      identifier title description url createdAt updatedAt archivedAt trashed
      priorityLabel
      state { name }
      team { key }
      project { name }
      creator { name }
      assignee { name }
      labels(first: 20) { nodes { name } }
      comments(first: 100) {
        nodes { body createdAt user { name } botActor { name } }
      }
    }
  }
}`

type IngestIssue = {
  identifier: string
  title: string
  description: string | null
  url: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  trashed: boolean | null
  priorityLabel: string
  state: { name: string } | null
  team: { key: string } | null
  project: { name: string } | null
  creator: { name: string } | null
  assignee: { name: string } | null
  labels: { nodes: { name: string }[] }
  comments: {
    nodes: {
      body: string
      createdAt: string
      user: { name: string } | null
      botActor: { name: string | null } | null
    }[]
  }
}

const day = (iso: string) => iso.slice(0, 10)

// One issue with its comments, as text for `source`. `ref` is an identifier
// (LOR-123) or an issue id; the stored key is always the identifier.
export const fetchLinearSourceItem: SourceFetcher = async (
  connection,
  _kind,
  ref
) => {
  const client = await linearClientFor(connection.externalId)
  if (!client) throw new Error("Linear connection unavailable")
  const identifier = linearIssueKey(ref)
  const match = identifier ? /^(.+)-(\d+)$/.exec(identifier) : null
  const filter = match
    ? { team: { key: { eq: match[1] } }, number: { eq: Number(match[2]) } }
    : { id: { eq: ref } }
  const response = await client.client.rawRequest<
    { issues: { nodes: IngestIssue[] } },
    { filter: typeof filter }
  >(INGEST_ISSUE_QUERY, { filter })
  const issue = response.data?.issues.nodes[0]
  if (!issue) {
    if (!response.data) throw new Error("Linear issue query returned no data")
    return { item: null, gone: identifier ? [identifier] : [] }
  }
  if (issue.trashed) return { item: null, gone: [issue.identifier] }

  // Integration comments (GitHub sync, bots) are machine text.
  const discussion = issue.comments.nodes
    .filter((c) => !c.botActor && c.body.trim())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(
      (c) =>
        `— ${c.user?.name ?? "unknown"} (${day(c.createdAt)}): ${c.body.trim()}`
    )
  const labels = issue.labels.nodes.map((l) => l.name)
  const state = issue.state?.name ?? null
  const meta = [
    `Issue ${issue.identifier}`,
    issue.archivedAt ? `${state ?? "unknown"} (archived)` : state,
    issue.project ? `project ${issue.project.name}` : null,
    issue.priorityLabel && issue.priorityLabel !== "No priority"
      ? `priority ${issue.priorityLabel}`
      : null,
    issue.creator ? `by ${issue.creator.name}` : null,
    issue.assignee ? `assigned to ${issue.assignee.name}` : null,
    `opened ${day(issue.createdAt)}`,
    labels.length > 0 ? `labels: ${labels.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return {
    item: {
      kind: "issue",
      externalId: issue.identifier,
      url: issue.url,
      title: issue.title,
      author: issue.creator?.name ?? null,
      state,
      body: [
        meta,
        issue.description?.trim() || "(no description)",
        ...discussion,
      ].join("\n\n"),
      sourceCreatedAt: new Date(issue.createdAt),
      sourceUpdatedAt: new Date(issue.updatedAt),
    },
    // A team move changes the identifier; the old key is gone.
    gone: identifier && identifier !== issue.identifier ? [identifier] : [],
  }
}

export const linearProvider: SourceProvider = {
  async verifyConnection(connection) {
    const client = await linearClientFor(connection.externalId)
    if (!client) return null
    const org = await client.organization.catch(() => null)
    return org ? { accountLabel: org.name } : null
  },
}
