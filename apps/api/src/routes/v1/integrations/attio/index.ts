import { createHmac, timingSafeEqual } from "node:crypto"
import type { ConnectorEventKey } from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { attioSearchResult } from "@repo/lor/attio"
import {
  attioRequest,
  fetchAttioCallRecording,
  formatAttioTranscript,
} from "@repo/lor/providers"
import { decryptSecret } from "@repo/utils/crypto"
import { attioNotificationEmbed } from "@/lib/connector-notification-embeds"
import {
  dispatchConnectorEvent,
  type EventItem,
} from "@/lib/connector-triggers"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"

// Attio event_type → curated ConnectorEventKey. Single source of truth: the
// connect flow subscribes the webhook to exactly these keys, and the receiver
// drops anything else. Adding an entry requires reconciling the subscriptions
// of existing Attio webhooks (reference/automation-primitives.md §10).
export const ATTIO_EVENT_SUBSCRIPTIONS = {
  "call-recording.created": "call_recording_ready",
  "note.created": "note_created",
  "list-entry.created": "list_entry_created",
} as const satisfies Record<string, ConnectorEventKey>

const attioRouter = createRouter()

// Deliveries are ids-only; even a batched delivery stays tiny.
const MAX_WEBHOOK_BYTES = 256 * 1024
// Attio retries a delivery for up to ~3 days; outlive that.
const DELIVERY_DEDUP_TTL_SECONDS = 4 * 24 * 60 * 60
const TRANSCRIPT_INGEST_MAX = 30_000
const CONTENT_INGEST_MAX = 20_000

type AttioEvent = {
  event_type?: string
  id?: Record<string, string | undefined>
  parent_object_id?: string
  parent_record_id?: string
}

type Connection = {
  id: string
  externalId: string
}

// A processor either isn't ready ("retry" → non-2xx so Attio redelivers with
// backoff — Attio is the retry scheduler, no queue needed), has nothing to do
// ("skip"), or returns the dispatch to run once every event is processed.
type ProcessOutcome = "retry" | "skip" | (() => Promise<unknown>)

function verifySignature(
  raw: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret)
    .update(raw, "utf8")
    .digest("hex")
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function hasEnabledTrigger(
  connectionId: string,
  event: ConnectorEventKey
): Promise<boolean> {
  const row = await db
    .select({ id: schema.connectorTrigger.id })
    .from(schema.connectorTrigger)
    .where(
      and(
        eq(schema.connectorTrigger.connectionId, connectionId),
        eq(schema.connectorTrigger.event, event),
        eq(schema.connectorTrigger.enabled, true)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  return !!row
}

// Best-effort record lookup for titles/links in POST text and Act payloads.
async function fetchRecordSummary(
  externalId: string,
  objectId: string | undefined,
  recordId: string | undefined
): Promise<{ title: string; url: string | null } | null> {
  if (!(objectId && recordId)) return null
  const response = await attioRequest<{ data?: unknown }>(
    externalId,
    `/objects/${encodeURIComponent(objectId)}/records/${encodeURIComponent(recordId)}`
  )
  if (!response?.data) return null
  const result = attioSearchResult(response.data)
  return { title: result.title, url: result.url ?? null }
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text

async function processCallRecording(
  connection: Connection,
  event: AttioEvent
): Promise<ProcessOutcome> {
  const meetingId = event.id?.meeting_id
  const recordingId = event.id?.call_recording_id
  if (!(meetingId && recordingId)) return "skip"

  const recording = await fetchAttioCallRecording(
    connection.externalId,
    meetingId,
    recordingId
  )
  // Transient fetch failure → let Attio redeliver.
  if (!recording) return "retry"
  if (recording.status === "failed") return "skip"
  // The event fires when the media upload completes, but transcription can
  // still lag — Attio's redelivery backoff is our wait loop.
  if (recording.status !== "completed" || !recording.segments?.length) {
    return "retry"
  }

  const meeting = await attioRequest<{ data?: { title?: unknown } }>(
    connection.externalId,
    `/meetings/${encodeURIComponent(meetingId)}`
  )
  const title =
    typeof meeting?.data?.title === "string" && meeting.data.title
      ? meeting.data.title
      : "Call recording"
  const transcript = formatAttioTranscript(
    recording.segments,
    TRANSCRIPT_INGEST_MAX
  )
  const lastEnd = recording.segments.at(-1)?.endTime ?? 0
  const minutes = Math.max(1, Math.round(lastEnd / 60))
  const link = recording.webUrl ? `[${title}](${recording.webUrl})` : title
  const participants = [
    ...new Set(recording.segments.map((s) => s.speaker)),
  ].filter((name) => name && name !== "Unknown")

  return () =>
    dispatchConnectorEvent({
      provider: "attio",
      externalId: connection.externalId,
      event: "call_recording_ready",
      label: "Attio",
      text: `**Call recording ready** ${link} — ${minutes} min`,
      embeds: [
        {
          ...attioNotificationEmbed({
            event: "Call recording ready",
            title,
            url: recording.webUrl,
            fields: [
              { name: "Duration", value: `${minutes} min`, inline: true },
            ],
          }),
          meeting: {
            meetingId,
            recordingId,
            durationMinutes: minutes,
            participants,
            transcript,
            transcriptTruncated: transcript.length > TRANSCRIPT_INGEST_MAX,
            followUps: [],
          },
        },
      ],
      item: {
        title,
        url: recording.webUrl,
        author: null,
        content: `${title}\n\n${transcript}`,
      } satisfies EventItem,
      ingested: true,
    })
}

async function processNote(
  connection: Connection,
  event: AttioEvent
): Promise<ProcessOutcome> {
  const noteId = event.id?.note_id
  if (!noteId) return "skip"

  const response = await attioRequest<{
    data?: {
      title?: unknown
      content_markdown?: unknown
      content_plaintext?: unknown
      parent_object?: unknown
      parent_record_id?: unknown
      created_at?: unknown
    }
  }>(connection.externalId, `/notes/${encodeURIComponent(noteId)}`)
  const note = response?.data
  if (!note) return "retry"

  const title =
    typeof note.title === "string" && note.title ? note.title : "Untitled note"
  const body =
    typeof note.content_markdown === "string" && note.content_markdown
      ? note.content_markdown
      : typeof note.content_plaintext === "string"
        ? note.content_plaintext
        : ""
  const record = await fetchRecordSummary(
    connection.externalId,
    event.parent_object_id ??
      (typeof note.parent_object === "string" ? note.parent_object : undefined),
    event.parent_record_id ??
      (typeof note.parent_record_id === "string"
        ? note.parent_record_id
        : undefined)
  )
  const context = record
    ? ` — on ${record.url ? `[${record.title}](${record.url})` : record.title}`
    : ""

  return () =>
    dispatchConnectorEvent({
      provider: "attio",
      externalId: connection.externalId,
      event: "note_created",
      label: "Attio",
      text: `**Note created** ${title}${context}`,
      embeds: [
        attioNotificationEmbed({
          event: "Note created",
          title,
          url: record?.url,
          body,
          fields: record
            ? [{ name: "Record", value: record.title, inline: true }]
            : undefined,
        }),
      ],
      item: {
        title,
        url: record?.url ?? null,
        author: null,
        content: clip(
          `${title}${record ? ` (note on ${record.title})` : ""}\n\n${body}`,
          CONTENT_INGEST_MAX
        ),
      } satisfies EventItem,
      ingested: true,
    })
}

async function processListEntry(
  connection: Connection,
  event: AttioEvent
): Promise<ProcessOutcome> {
  const listId = event.id?.list_id
  const entryId = event.id?.entry_id
  if (!(listId && entryId)) return "skip"

  const [list, record] = await Promise.all([
    attioRequest<{ data?: { name?: unknown } }>(
      connection.externalId,
      `/lists/${encodeURIComponent(listId)}`
    ),
    fetchRecordSummary(
      connection.externalId,
      event.parent_object_id,
      event.parent_record_id
    ),
  ])
  if (!list?.data) return "retry"
  const listName =
    typeof list.data.name === "string" && list.data.name
      ? list.data.name
      : "a list"
  const recordTitle = record?.title ?? "A record"
  const link = record?.url ? `[${recordTitle}](${record.url})` : recordTitle

  return () =>
    dispatchConnectorEvent({
      provider: "attio",
      externalId: connection.externalId,
      event: "list_entry_created",
      label: "Attio",
      text: `**${link}** was added to **${listName}**`,
      embeds: [
        attioNotificationEmbed({
          event: "Record added to a list",
          title: recordTitle,
          url: record?.url,
          fields: [{ name: "List", value: listName, inline: true }],
        }),
      ],
      item: {
        title: `${recordTitle} added to ${listName}`,
        url: record?.url ?? null,
        author: null,
        content: `${recordTitle} was added to the "${listName}" list in Attio.`,
      } satisfies EventItem,
    })
}

const PROCESSORS: Record<
  (typeof ATTIO_EVENT_SUBSCRIPTIONS)[keyof typeof ATTIO_EVENT_SUBSCRIPTIONS],
  (connection: Connection, event: AttioEvent) => Promise<ProcessOutcome>
> = {
  call_recording_ready: processCallRecording,
  note_created: processNote,
  list_entry_created: processListEntry,
}

// Plain (non-OpenAPI) route: needs the raw body for signature verification and
// is authenticated by the signature, not a session. Deliveries are ids-only —
// every event is fetch-on-delivery.
attioRouter.post("/integrations/attio/webhook", async (c) => {
  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    logger.error("INTEGRATION_ENCRYPTION_KEY not set; rejecting Attio webhook")
    return c.json({ ok: false }, 503)
  }
  if (Number(c.req.header("content-length") ?? 0) > MAX_WEBHOOK_BYTES) {
    return c.json({ ok: false }, 413)
  }
  const raw = await c.req.text()
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) {
    return c.json({ ok: false }, 413)
  }

  let payload: { webhook_id?: string; events?: AttioEvent[] }
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    return c.json({ ok: false }, 400)
  }
  if (typeof payload?.webhook_id !== "string" || !payload.webhook_id) {
    return c.json({ ok: false }, 400)
  }

  const connection = await db
    .select({
      id: schema.integrationConnection.id,
      externalId: schema.integrationConnection.externalId,
      webhookSecret: schema.integrationConnection.webhookSecret,
    })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.provider, "attio"),
        eq(schema.integrationConnection.webhookId, payload.webhook_id),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!connection?.webhookSecret) {
    return c.json({ ok: false }, 404)
  }

  let secret: string
  try {
    secret = decryptSecret(
      connection.webhookSecret,
      env.INTEGRATION_ENCRYPTION_KEY
    )
  } catch (err) {
    logger.error({ err }, "Attio webhook secret decryption failed")
    return c.json({ ok: false }, 500)
  }
  const signature =
    c.req.header("attio-signature") ?? c.req.header("x-attio-signature") ?? ""
  if (!verifySignature(raw, signature, secret)) {
    return c.json({ ok: false }, 401)
  }

  // At-least-once delivery: claim the Idempotency-Key before side effects.
  // Redis trouble → proceed: a duplicate message beats a dropped event.
  const idempotencyKey = c.req.header("idempotency-key") ?? ""
  const claimKey = idempotencyKey ? `lor:attio:webhook:${idempotencyKey}` : null
  const releaseClaim = async () => {
    if (!claimKey) return
    try {
      const redis = await getRedisClient()
      await redis.del(claimKey)
    } catch (err) {
      logger.warn({ err, idempotencyKey }, "Failed to release Attio claim")
    }
  }
  if (claimKey) {
    try {
      const redis = await getRedisClient()
      const first = await redis.set(claimKey, "1", {
        NX: true,
        EX: DELIVERY_DEDUP_TTL_SECONDS,
      })
      if (first !== "OK") return c.json({ ok: true })
    } catch (err) {
      logger.warn({ err, idempotencyKey }, "Attio webhook dedup unavailable")
    }
  }

  // One event per delivery today; iterate defensively (batching is reserved).
  const dispatches: Array<() => Promise<unknown>> = []
  for (const event of payload.events ?? []) {
    const key =
      ATTIO_EVENT_SUBSCRIPTIONS[
        event.event_type as keyof typeof ATTIO_EVENT_SUBSCRIPTIONS
      ]
    if (!key) continue
    // No trigger = event off; skip before spending API calls on fetches.
    if (!(await hasEnabledTrigger(connection.id, key))) continue
    try {
      const outcome = await PROCESSORS[key](connection, event)
      if (outcome === "retry") {
        await releaseClaim()
        return c.json({ ok: false, retry: true }, 503)
      }
      if (outcome !== "skip") dispatches.push(outcome)
    } catch (err) {
      logger.error({ err, event: key }, "Attio webhook processing failed")
      await releaseClaim()
      return c.json({ ok: false }, 500)
    }
  }

  // Dispatch, then ack, so a failure can release the claim and 503 and Attio
  // actually redelivers (a detached failure after a 200 ack was silently lost).
  try {
    await Promise.all(dispatches.map((run) => run()))
  } catch (err) {
    logger.error({ err }, "Attio webhook dispatch failed")
    await releaseClaim()
    return c.json({ ok: false, retry: true }, 503)
  }

  return c.json({ ok: true })
})

export default attioRouter
