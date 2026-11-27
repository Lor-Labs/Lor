import { createHash } from "node:crypto"
import { granolaNoteKey } from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { logger } from "../logger"
import type { SourceFetch, SourceFetcher, SourceProvider } from "./types"

// Granola's public API with a workspace API key (Business or Enterprise).
// reference/granola-connector.md.
const API_URL = "https://public-api.granola.ai/v1"
const REQUEST_TIMEOUT_MS = 15_000
const ACCOUNT_LABEL = "Granola workspace"

// All three: `note.generated` and `note.access_granted` are a new meeting,
// `note.edited` only refreshes the stored copy.
export const GRANOLA_WEBHOOK_EVENTS = [
  "note.generated",
  "note.access_granted",
  "note.edited",
] as const

export type GranolaUser = { name: string | null; email: string }

export type GranolaSpeaker = {
  source?: "microphone" | "speaker"
  attribution?: "me" | "them"
  diarization_label?: string
  name?: string
}

export type GranolaTranscriptItem = {
  speaker?: GranolaSpeaker
  text?: string
  start_time?: string
  end_time?: string
}

export type GranolaNote = {
  id: string
  title: string | null
  owner?: GranolaUser
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
  web_url?: string
  calendar_event?: {
    event_title?: string | null
    invitees?: { email: string }[]
    organiser?: string | null
    scheduled_start_time?: string | null
    scheduled_end_time?: string | null
  } | null
  attendees?: GranolaUser[]
  folder_membership?: { id: string; name: string }[]
  summary_text?: string
  summary_markdown?: string | null
  transcript?: GranolaTranscriptItem[] | null
}

function encryptionKey(): string {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set; Granola is unavailable"
    )
  }
  return key
}

function call(apiKey: string, path: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

export function granolaFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex")
}

export async function getGranolaApiKey(
  externalId: string
): Promise<string | null> {
  const row = await db
    .select({ apiKey: schema.integrationConnection.apiKey })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.provider, "granola"),
        eq(schema.integrationConnection.externalId, externalId),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!row?.apiKey) return null
  try {
    return decryptSecret(row.apiKey, encryptionKey())
  } catch {
    return null
  }
}

export type GranolaResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string }

// One read through the stored key. Never throws: tools return the message.
export async function granolaRequest<T>(
  externalId: string,
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown }
): Promise<GranolaResult<T>> {
  const apiKey = await getGranolaApiKey(externalId)
  if (!apiKey) {
    return {
      ok: false,
      status: 401,
      message: "Granola isn't connected for this workspace",
    }
  }
  try {
    const res = await call(apiKey, path, {
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
    if (res.ok) return { ok: true, data: (await res.json()) as T }
    const body = (await res.json().catch(() => null)) as {
      message?: unknown
    } | null
    return {
      ok: false,
      status: res.status,
      message:
        typeof body?.message === "string"
          ? `Granola: ${body.message}`
          : `Granola returned ${res.status}`,
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: `Granola request failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export type GranolaConnectError =
  | "invalid_key"
  | "not_workspace_key"
  | "webhooks_unavailable"
  | "webhook_failed"

export type GranolaConnection = {
  externalId: string
  accountLabel: string
  apiKey: string
  webhookId: string | null
  webhookSecret: string | null
}

// Remove endpoints a previous connect pointed at the same URL, so a
// reconnect doesn't leave a second endpoint delivering with a lost secret.
async function removeStaleEndpoints(apiKey: string, targetUrl: string) {
  try {
    const res = await call(apiKey, "/webhook-endpoints")
    if (!res.ok) return
    const body = (await res.json()) as {
      webhook_endpoints?: { id?: string; url?: string }[]
    }
    const rows = body.webhook_endpoints ?? []
    await Promise.all(
      rows
        .filter((row) => row.id && row.url === targetUrl)
        .map((row) =>
          call(
            apiKey,
            `/webhook-endpoints/${encodeURIComponent(row.id ?? "")}`,
            {
              method: "DELETE",
            }
          ).catch(() => null)
        )
    )
  } catch (err) {
    logger.warn({ err }, "Granola stale webhook cleanup failed")
  }
}

// Registering the endpoint with scope `workspace` is also the workspace-key
// check: Granola refuses that scope for a personal key.
async function createWebhook(
  apiKey: string,
  targetUrl: string
): Promise<{ id: string; secret: string } | GranolaConnectError> {
  await removeStaleEndpoints(apiKey, targetUrl)
  const res = await call(apiKey, "/webhook-endpoints", {
    method: "POST",
    body: JSON.stringify({
      url: targetUrl,
      scopes: ["workspace"],
      events: GRANOLA_WEBHOOK_EVENTS,
    }),
  })
  if (res.status === 400 || res.status === 403) return "not_workspace_key"
  if (res.status === 404) return "webhooks_unavailable"
  if (!res.ok) {
    logger.error({ status: res.status }, "Granola webhook creation failed")
    return "webhook_failed"
  }
  const body = (await res.json()) as { id?: string; signing_secret?: string }
  if (!(body.id && body.signing_secret)) return "webhook_failed"
  return { id: body.id, secret: body.signing_secret }
}

export async function deleteGranolaWebhook(
  apiKey: string,
  endpointId: string
): Promise<void> {
  try {
    await call(apiKey, `/webhook-endpoints/${encodeURIComponent(endpointId)}`, {
      method: "DELETE",
    })
  } catch (err) {
    logger.warn({ err, endpointId }, "Granola webhook deletion failed")
  }
}

// The webhook needs a public HTTPS URL; in local development there is none,
// so the key is accepted without its webhook (and without the workspace-key
// check). `targetUrl` is null then.
export async function connectGranola(
  apiKey: string,
  targetUrlFor: ((externalId: string) => string) | null
): Promise<GranolaConnection | GranolaConnectError> {
  const key = encryptionKey()
  const probe = await call(apiKey, "/notes?page_size=1").catch(() => null)
  if (!probe?.ok) return "invalid_key"

  const externalId = granolaFingerprint(apiKey)
  let webhook: { id: string; secret: string } | null = null
  if (targetUrlFor) {
    const created = await createWebhook(apiKey, targetUrlFor(externalId))
    if (typeof created === "string") return created
    webhook = created
  } else {
    logger.warn(
      "Granola connected without a webhook: the API URL is not public HTTPS"
    )
  }
  try {
    return {
      externalId,
      accountLabel: ACCOUNT_LABEL,
      apiKey: encryptSecret(apiKey, key),
      webhookId: webhook?.id ?? null,
      webhookSecret: webhook ? encryptSecret(webhook.secret, key) : null,
    }
  } catch (err) {
    if (webhook) await deleteGranolaWebhook(apiKey, webhook.id)
    throw err
  }
}

export const granolaProvider: SourceProvider = {
  async verifyConnection(connection) {
    const res = await granolaRequest(
      connection.externalId,
      "/notes?page_size=1"
    )
    return res.ok ? { accountLabel: ACCOUNT_LABEL } : null
  },
}

function speakerName(item: GranolaTranscriptItem, owner: string | null) {
  const speaker = item.speaker
  if (speaker?.name) return speaker.name
  if (speaker?.attribution === "me" || speaker?.source === "microphone") {
    return owner ?? "Note taker"
  }
  return speaker?.diarization_label ?? "Them"
}

// Consecutive lines from one speaker are joined, so the text reads as turns.
export function formatGranolaTranscript(
  items: readonly GranolaTranscriptItem[],
  owner: string | null,
  max: number
): string {
  const turns: { speaker: string; text: string }[] = []
  for (const item of items) {
    const text = item.text?.trim()
    if (!text) continue
    const speaker = speakerName(item, owner)
    const last = turns.at(-1)
    if (last?.speaker === speaker) last.text += ` ${text}`
    else turns.push({ speaker, text })
  }
  const out = turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n")
  return out.length > max ? `${out.slice(0, max)}…` : out
}

// Granola caps the inline transcript (413); page through the transcript
// endpoint up to `maxChars`.
export async function fetchGranolaTranscript(
  externalId: string,
  noteId: string,
  maxChars: number,
  fromTime?: string
): Promise<GranolaResult<GranolaTranscriptItem[]>> {
  const items: GranolaTranscriptItem[] = []
  let cursor: string | null = null
  let chars = 0
  do {
    const query = new URLSearchParams({ page_size: "100" })
    if (cursor) query.set("cursor", cursor)
    else if (fromTime) query.set("from_time", fromTime)
    const page: GranolaResult<{
      transcript: GranolaTranscriptItem[]
      hasMore: boolean
      cursor: string | null
    }> = await granolaRequest(
      externalId,
      `/notes/${encodeURIComponent(noteId)}/transcript?${query}`
    )
    if (!page.ok) return page
    for (const item of page.data.transcript) {
      items.push(item)
      chars += item.text?.length ?? 0
    }
    cursor = page.data.hasMore ? page.data.cursor : null
  } while (cursor && chars < maxChars)
  return { ok: true, data: items }
}

export async function fetchGranolaNote(
  externalId: string,
  noteId: string,
  withTranscript: boolean,
  transcriptMax: number
): Promise<GranolaResult<GranolaNote>> {
  const path = `/notes/${encodeURIComponent(noteId)}`
  const note = await granolaRequest<GranolaNote>(
    externalId,
    withTranscript ? `${path}?include=transcript` : path
  )
  if (note.ok || note.status !== 413 || !withTranscript) return note
  const [plain, transcript] = await Promise.all([
    granolaRequest<GranolaNote>(externalId, path),
    fetchGranolaTranscript(externalId, noteId, transcriptMax),
  ])
  if (!plain.ok) return plain
  return {
    ok: true,
    data: {
      ...plain.data,
      transcript: transcript.ok ? transcript.data : null,
    },
  }
}

export function granolaAttendees(note: GranolaNote): string[] {
  const named = (note.attendees ?? []).map((a) => a.name?.trim() || a.email)
  return [...new Set(named)].filter(Boolean)
}

export function granolaMeetingAt(note: GranolaNote): string | null {
  return note.calendar_event?.scheduled_start_time ?? note.created_at ?? null
}

export function granolaMinutes(note: GranolaNote): number | null {
  const start = note.calendar_event?.scheduled_start_time
  const end = note.calendar_event?.scheduled_end_time
  const first = note.transcript?.[0]?.start_time
  const last = note.transcript?.at(-1)?.end_time
  const [from, to] = first && last ? [first, last] : [start, end]
  if (!(from && to)) return null
  const minutes = Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / 60_000
  )
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null
}

// Below storeSourceItem's body cap, leaving room for the summary.
const SOURCE_TRANSCRIPT_MAX = 150_000

export const GRANOLA_MEETING_KIND = "meeting"

// One meeting as text for `source`: a metadata line, the summary, then the
// transcript. A ref is the stored key (the lowercase note id).
export const fetchGranolaSourceItem: SourceFetcher = async (
  connection,
  kind,
  ref
): Promise<SourceFetch> => {
  if (kind !== GRANOLA_MEETING_KIND) return { item: null, gone: [] }
  const res = await fetchGranolaNote(
    connection.externalId,
    ref,
    true,
    SOURCE_TRANSCRIPT_MAX
  )
  if (!res.ok) {
    if (res.status === 404) return { item: null, gone: [ref] }
    throw new Error(res.message)
  }
  const note = res.data
  if (note.deleted_at) return { item: null, gone: [ref] }
  const owner = note.owner?.name ?? note.owner?.email ?? null
  const meetingAt = granolaMeetingAt(note)
  const minutes = granolaMinutes(note)
  const attendees = granolaAttendees(note)
  const meta = [
    minutes ? `Granola meeting · ${minutes} min` : "Granola meeting",
    meetingAt ? `held ${meetingAt.slice(0, 10)}` : null,
    owner ? `notes by ${owner}` : null,
    attendees.length > 0 ? `attendees: ${attendees.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const transcript = note.transcript?.length
    ? formatGranolaTranscript(note.transcript, owner, SOURCE_TRANSCRIPT_MAX)
    : null
  return {
    item: {
      kind: GRANOLA_MEETING_KIND,
      externalId: granolaNoteKey(note.id),
      url: note.web_url ?? null,
      title:
        note.title?.trim() ||
        note.calendar_event?.event_title?.trim() ||
        "Untitled meeting",
      author: owner,
      state: null,
      body: [
        meta,
        note.summary_markdown?.trim() || note.summary_text?.trim() || null,
        transcript ? `Transcript\n\n${transcript}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      sourceCreatedAt: meetingAt ? new Date(meetingAt) : null,
      sourceUpdatedAt: note.updated_at ? new Date(note.updated_at) : null,
    },
    gone: [],
  }
}
