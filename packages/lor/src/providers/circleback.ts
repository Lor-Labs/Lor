import { createHash } from "node:crypto"
import { circlebackMeetingKey } from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import type { SourceItem } from "../sources"
import type { SourceProvider } from "./types"

// Circleback's API with a read-only key (cb_…). A key acts as one person: it
// reads their meetings and those shared with them. Meetings from a workspace
// automation's webhook can belong to anyone, so they are stored from the
// payload, not refetched. reference/circleback-connector.md.
const API_URL = "https://circleback.ai/api"
const REQUEST_TIMEOUT_MS = 15_000

export const CIRCLEBACK_MEETING_KIND = "meeting"

export type CirclebackPerson = {
  profileId?: number
  name?: string | null
  email?: string | null
  title?: string | null
  companyName?: string | null
}

export type CirclebackActionItem = {
  id: number
  title?: string | null
  description?: string | null
  assignee?: CirclebackPerson | null
  status?: "PENDING" | "DONE"
  completedAt?: string | null
  // The list endpoint always sends `meetingIds`; `meetings` is optional.
  meetingIds?: string[]
  meetings?: { id: string; name?: string | null; createdAt?: string }[]
}

export type CirclebackTranscriptSegment = {
  speaker?: string | null
  text?: string | null
  timestamp?: number | null
}

export type CirclebackMeeting = {
  id: string
  name?: string | null
  createdAt?: string
  updatedAt?: string
  // Seconds.
  duration?: number | null
  url?: string | null
  tags?: ({ name?: string } | string)[]
  attendees?: CirclebackPerson[]
  notes?: string | null
  actionItems?: CirclebackActionItem[]
  // Only in webhook payloads; the API has its own endpoint.
  transcript?: CirclebackTranscriptSegment[]
}

function encryptionKey(): string {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set; Circleback is unavailable"
    )
  }
  return key
}

function call(apiKey: string, path: string) {
  return fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

export function circlebackMeetingUrl(id: string): string {
  return `https://circleback.ai/meetings/${encodeURIComponent(id)}`
}

export async function getCirclebackApiKey(
  externalId: string
): Promise<string | null> {
  const row = await db
    .select({ apiKey: schema.integrationConnection.apiKey })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.provider, "circleback"),
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

export type CirclebackResult<T> =
  | { ok: true; data: T; next: string | null }
  | { ok: false; status: number; message: string }

// The next page's cursor, from the RFC 8288 `Link: <…>; rel="next"` header.
function nextCursor(link: string | null): string | null {
  const match = link?.match(/<([^>]+)>\s*;\s*rel="?next"?/)
  if (!match?.[1]) return null
  try {
    return new URL(match[1], API_URL).searchParams.get("cursor")
  } catch {
    return null
  }
}

// One read through the stored key. Never throws: tools return the message.
export async function circlebackRequest<T>(
  externalId: string,
  path: string
): Promise<CirclebackResult<T>> {
  const apiKey = await getCirclebackApiKey(externalId)
  if (!apiKey) {
    return {
      ok: false,
      status: 401,
      message: "Circleback isn't connected for this workspace",
    }
  }
  try {
    const res = await call(apiKey, path)
    if (res.ok) {
      return {
        ok: true,
        data: (await res.json()) as T,
        next: nextCursor(res.headers.get("link")),
      }
    }
    const body = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    return {
      ok: false,
      status: res.status,
      message:
        typeof body?.error === "string"
          ? `Circleback: ${body.error}`
          : `Circleback returned ${res.status}`,
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: `Circleback request failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export type CirclebackConnection = {
  externalId: string
  accountLabel: string
  apiKey: string
}

// `GET /oauth/test` names the key's account; it is the key check.
export async function connectCircleback(
  apiKey: string
): Promise<CirclebackConnection | null> {
  const key = encryptionKey()
  const res = await call(apiKey, "/oauth/test").catch(() => null)
  if (!res?.ok) return null
  const body = (await res.json().catch(() => null)) as {
    email?: unknown
  } | null
  return {
    externalId: createHash("sha256").update(apiKey).digest("hex"),
    accountLabel:
      typeof body?.email === "string" && body.email
        ? body.email
        : "Circleback account",
    apiKey: encryptSecret(apiKey, key),
  }
}

export const circlebackProvider: SourceProvider = {
  async verifyConnection(connection) {
    const res = await circlebackRequest<{ email?: string }>(
      connection.externalId,
      "/oauth/test"
    )
    return res.ok
      ? { accountLabel: res.data.email ?? "Circleback account" }
      : null
  },
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

// Consecutive lines from one speaker are joined; each turn keeps its start
// time so an agent can point at a moment. `marks` is each segment's offset.
function transcriptLines(segments: readonly CirclebackTranscriptSegment[]) {
  let out = ""
  let lastSpeaker: string | null = null
  const marks: { offset: number; at: number | null }[] = []
  for (const segment of segments) {
    const text = segment.text?.trim()
    if (!text) continue
    const speaker = segment.speaker?.trim() || "Speaker"
    const at = segment.timestamp ?? null
    if (speaker === lastSpeaker) {
      marks.push({ offset: out.length + 1, at })
      out += ` ${text}`
      continue
    }
    if (out) out += "\n"
    marks.push({ offset: out.length, at })
    out += `${at === null ? "" : `[${clock(at)}] `}${speaker}: ${text}`
    lastSpeaker = speaker
  }
  return { out, marks }
}

export function formatCirclebackTranscript(
  segments: readonly CirclebackTranscriptSegment[],
  max: number
): string {
  const { out } = transcriptLines(segments)
  return out.length > max ? `${out.slice(0, max)}…` : out
}

// Transcript continuation: the second (for `fromSeconds`) of the segment the
// cut at `max` fell in, so no unread text is skipped. Null when nothing was cut.
export function circlebackTranscriptResume(
  segments: readonly CirclebackTranscriptSegment[],
  max: number
): number | null {
  const { out, marks } = transcriptLines(segments)
  if (out.length <= max) return null
  const start = marks.find((m) => m.at !== null)?.at ?? null
  let resume: number | null = null
  for (const mark of marks) {
    if (mark.at === null) continue
    const second = Math.floor(mark.at)
    // Past the first second, or the same call would come back.
    if (start !== null && second <= start) continue
    if (mark.offset > max) return resume ?? second
    resume = second
  }
  return resume
}

export function circlebackAttendees(meeting: CirclebackMeeting): string[] {
  const named = (meeting.attendees ?? []).map(
    (a) => a.name?.trim() || a.email?.trim() || ""
  )
  return [...new Set(named)].filter(Boolean)
}

export function circlebackMinutes(meeting: CirclebackMeeting): number | null {
  const seconds = meeting.duration ?? 0
  return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null
}

export function circlebackTitle(meeting: CirclebackMeeting): string {
  return meeting.name?.trim() || "Untitled meeting"
}

export function formatCirclebackActionItems(
  items: readonly CirclebackActionItem[]
): string {
  return items
    .map((item) => {
      const who = item.assignee?.name || item.assignee?.email
      const done = item.status === "DONE" ? " (done)" : ""
      return `- ${item.title?.trim() || "Untitled"}${who ? ` — ${who}` : ""}${done}`
    })
    .join("\n")
}

// Below storeSourceItem's body cap, leaving room for the notes.
const SOURCE_TRANSCRIPT_MAX = 150_000

// One meeting as text for `source`: a metadata line, the notes, the action
// items, then the transcript. The key is the meeting id.
export function circlebackSourceItem(meeting: CirclebackMeeting): SourceItem {
  const minutes = circlebackMinutes(meeting)
  const attendees = circlebackAttendees(meeting)
  const tags = (meeting.tags ?? [])
    .map((tag) => (typeof tag === "string" ? tag : tag.name))
    .filter((tag): tag is string => Boolean(tag))
  const meta = [
    minutes ? `Circleback meeting · ${minutes} min` : "Circleback meeting",
    meeting.createdAt ? `held ${meeting.createdAt.slice(0, 10)}` : null,
    attendees.length > 0 ? `attendees: ${attendees.join(", ")}` : null,
    tags.length > 0 ? `tags: ${tags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const actionItems = meeting.actionItems?.length
    ? `Action items\n\n${formatCirclebackActionItems(meeting.actionItems)}`
    : null
  const transcript = meeting.transcript?.length
    ? `Transcript\n\n${formatCirclebackTranscript(meeting.transcript, SOURCE_TRANSCRIPT_MAX)}`
    : null
  return {
    kind: CIRCLEBACK_MEETING_KIND,
    externalId: circlebackMeetingKey(meeting.id),
    url: circlebackMeetingUrl(meeting.id),
    title: circlebackTitle(meeting),
    author: null,
    state: null,
    body: [meta, meeting.notes?.trim() || null, actionItems, transcript]
      .filter(Boolean)
      .join("\n\n"),
    sourceCreatedAt: meeting.createdAt ? new Date(meeting.createdAt) : null,
    sourceUpdatedAt: meeting.updatedAt ? new Date(meeting.updatedAt) : null,
  }
}
