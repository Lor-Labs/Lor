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

export const ATTIO_WRITE_SCOPES = [
  "record_permission:read-write",
  "list_entry:read-write",
  "note:read-write",
  "task:read-write",
] as const

type AttioWriteScope = (typeof ATTIO_WRITE_SCOPES)[number]

// Webhook administration stays internal to connect/disconnect.
export const ATTIO_WEBHOOK_SCOPE = "webhook:read-write"

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
  const allowedWrites = new Set<string>([
    ...ATTIO_WRITE_SCOPES,
    ATTIO_WEBHOOK_SCOPE,
  ])
  const forbiddenWrite = [...scopes].some(
    (value) => value.endsWith(":read-write") && !allowedWrites.has(value)
  )
  if (forbiddenWrite) return false
  if (!scopes.has(ATTIO_WEBHOOK_SCOPE)) return false
  // A reviewed read-write scope also satisfies the corresponding read baseline.
  return ATTIO_REQUIRED_READ_SCOPES.every(
    (required) =>
      scopes.has(required) ||
      scopes.has(required.replace(/:read$/, ":read-write"))
  )
}

type AttioWebhookConfig = {
  targetUrl: string
  eventTypes: readonly string[]
}

type AttioWebhookRow = {
  id?: { webhook_id?: string }
  target_url?: string
  secret?: string
}

// Create the workspace's event webhook. Reconnects would otherwise accumulate
// stale webhooks that keep delivering (with secrets we no longer hold) until
// Attio marks them degraded — so delete any existing webhook pointed at our
// target first.
async function createAttioWebhook(
  token: string,
  config: AttioWebhookConfig
): Promise<{ webhookId: string; secret: string } | null> {
  try {
    const existing = await fetch(`${API_URL}/webhooks?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (existing.ok) {
      const body = (await existing.json()) as { data?: AttioWebhookRow[] }
      const stale = (body.data ?? []).filter(
        (row) => row.target_url === config.targetUrl && row.id?.webhook_id
      )
      await Promise.all(
        stale.map((row) =>
          fetch(`${API_URL}/webhooks/${row.id?.webhook_id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }).catch(() => null)
        )
      )
    }

    const res = await fetch(`${API_URL}/webhooks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          target_url: config.targetUrl,
          subscriptions: config.eventTypes.map((eventType) => ({
            event_type: eventType,
            filter: null,
          })),
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.error({ status: res.status }, "Attio webhook creation failed")
      return null
    }
    const body = (await res.json()) as { data?: AttioWebhookRow }
    const webhookId = body.data?.id?.webhook_id
    const secret = body.data?.secret
    if (!webhookId || !secret) return null
    return { webhookId, secret }
  } catch (err) {
    logger.error({ err }, "Attio webhook creation error")
    return null
  }
}

// Best-effort cleanup on disconnect; a leftover webhook just degrades on
// Attio's side once we stop acking it.
export async function deleteAttioWebhook(
  token: string,
  webhookId: string
): Promise<void> {
  try {
    await fetch(`${API_URL}/webhooks/${encodeURIComponent(webhookId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    logger.warn({ err, webhookId }, "Attio webhook deletion failed")
  }
}

export async function connectAttio(
  code: string,
  redirectUri: string,
  webhook?: AttioWebhookConfig
): Promise<{
  externalId: string
  accountLabel: string | null
  accessToken: string
  tokenExpiresAt: Date | null
  scope: string
  webhookId: string | null
  webhookSecret: string | null
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
        "Attio token is inactive, missing required reads/webhook access, or has unsupported write scopes"
      )
      return null
    }

    // Fail the connect loudly when webhook registration fails — a connection
    // without its webhook silently delivers no events.
    let registered: { webhookId: string; secret: string } | null = null
    if (webhook) {
      registered = await createAttioWebhook(tokenData.access_token, webhook)
      if (!registered) return null
    }

    try {
      return {
        externalId: identity.workspace_id,
        accountLabel:
          identity.workspace_name ?? identity.workspace_slug ?? null,
        accessToken: encryptSecret(tokenData.access_token, encryptionKey()),
        tokenExpiresAt:
          typeof identity.exp === "number"
            ? new Date(identity.exp * 1000)
            : null,
        scope: identity.scope ?? "",
        webhookId: registered?.webhookId ?? null,
        webhookSecret: registered
          ? encryptSecret(registered.secret, encryptionKey())
          : null,
      }
    } catch (err) {
      // Encryption failed after the webhook was registered — remove it so the
      // aborted connect doesn't leave a live webhook POSTing at us.
      if (registered) {
        await deleteAttioWebhook(tokenData.access_token, registered.webhookId)
      }
      throw err
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

export type AttioWriteResult<T> =
  | { data: T }
  | {
      error: string
      outcome: "failed" | "unknown"
      requiresReconnection?: boolean
    }

// One mutation, without automatic retries: a timeout may follow a committed write.
export async function attioWriteRequest<T>(
  externalId: string,
  path: string,
  method: "POST" | "PATCH" | "PUT",
  data: unknown,
  requiredScope: AttioWriteScope
): Promise<AttioWriteResult<T>> {
  const token = await getAttioAccessToken(externalId)
  if (!token)
    return {
      error: "Reconnect Attio before writing.",
      outcome: "failed",
      requiresReconnection: true,
    }
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.ok) {
      const response: unknown = await res.json()
      if (
        !(
          response &&
          typeof response === "object" &&
          "data" in response &&
          response.data &&
          typeof response.data === "object" &&
          !Array.isArray(response.data)
        )
      )
        throw new Error("Attio write receipt unavailable")
      return { data: response as T }
    }
    logger.warn({ path, status: res.status }, "Attio write request failed")
    if (res.status === 401 || res.status === 403)
      return {
        error: `Attio denied this write. Enable ${requiredScope} in the Attio app, reconnect Attio in Lor, and check access to the target record or list.`,
        outcome: "failed",
        requiresReconnection: true,
      }
    if (res.status >= 400 && res.status < 500 && res.status !== 408) {
      const body = (await res.json().catch(() => null)) as {
        message?: unknown
      } | null
      return {
        error:
          typeof body?.message === "string"
            ? body.message.slice(0, 1000)
            : `Attio rejected this write (HTTP ${res.status}).`,
        outcome: "failed",
      }
    }
  } catch {
    logger.warn({ path }, "Attio write response unavailable")
  }
  return {
    error:
      "Attio did not confirm whether this write completed. Check the record, list entry, note, or task before making another write; do not automatically repeat this action.",
    outcome: "unknown",
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

export type AttioTranscriptSegment = {
  speech: string
  speaker: string
  endTime: number
}

export type AttioCallRecording = {
  status: string
  webUrl: string | null
  createdAt: string | null
  segments: AttioTranscriptSegment[] | null
}

// GET the recording via the current endpoint (the old `…/transcript` route is
// deprecated in its favor); `transcript.segments` arrives whole, no paging.
export async function fetchAttioCallRecording(
  externalId: string,
  meetingId: string,
  recordingId: string
): Promise<AttioCallRecording | null> {
  const response = await attioRequest<{ data?: unknown }>(
    externalId,
    `/meetings/${encodeURIComponent(meetingId)}/call_recordings/${encodeURIComponent(recordingId)}`
  )
  const data = response?.data
  if (typeof data !== "object" || data === null) return null
  const record = data as {
    status?: unknown
    web_url?: unknown
    created_at?: unknown
    transcript?: { segments?: unknown } | null
  }
  const rawSegments = Array.isArray(record.transcript?.segments)
    ? record.transcript.segments
    : null
  const segments = rawSegments
    ?.map((segment: unknown): AttioTranscriptSegment | null => {
      if (typeof segment !== "object" || segment === null) return null
      const s = segment as {
        speech?: unknown
        end_time?: unknown
        speaker?: { name?: unknown }
      }
      if (typeof s.speech !== "string") return null
      return {
        speech: s.speech,
        speaker:
          typeof s.speaker?.name === "string" ? s.speaker.name : "Unknown",
        endTime: typeof s.end_time === "number" ? s.end_time : 0,
      }
    })
    .filter((segment): segment is AttioTranscriptSegment => segment !== null)
  return {
    status: typeof record.status === "string" ? record.status : "processing",
    webUrl: typeof record.web_url === "string" ? record.web_url : null,
    createdAt: typeof record.created_at === "string" ? record.created_at : null,
    segments: segments ?? null,
  }
}

// Segments are sub-sentence fragments; group consecutive same-speaker runs
// into "Name: …" lines and cap total length.
export function formatAttioTranscript(
  segments: readonly AttioTranscriptSegment[],
  maxChars: number
): string {
  const lines: string[] = []
  let speaker: string | null = null
  let parts: string[] = []
  const flush = () => {
    if (speaker !== null && parts.length > 0) {
      lines.push(`${speaker}: ${parts.join(" ")}`)
    }
    parts = []
  }
  for (const segment of segments) {
    if (segment.speaker !== speaker) {
      flush()
      speaker = segment.speaker
    }
    const speech = segment.speech.trim()
    if (speech) parts.push(speech)
  }
  flush()
  const text = lines.join("\n")
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}
