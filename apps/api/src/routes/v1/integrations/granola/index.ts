import { createHmac, timingSafeEqual } from "node:crypto"
import { granolaNoteKey } from "@repo/connectors"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import {
  fetchGranolaNote,
  formatGranolaTranscript,
  GRANOLA_MEETING_KIND,
  granolaAttendees,
  granolaMinutes,
} from "@repo/lor/providers"
import { decryptSecret } from "@repo/utils/crypto"
import { granolaNotificationEmbed } from "@/lib/connector-notification-embeds"
import {
  dispatchConnectorEvent,
  type EventItem,
} from "@/lib/connector-triggers"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"
import { enqueueSourceIngest } from "@/lib/source-ingest-queue"

// Granola webhooks (reference/granola-connector.md): Standard Webhooks
// signing, ids-only deliveries, retried for four days on a non-2xx. Every
// event refetches the meeting into `source`; a new meeting (`note.generated`,
// or `note.access_granted` for one shared later) is "Meeting notes ready".

const granolaRouter = createRouter()

const MAX_WEBHOOK_BYTES = 64 * 1024
// Standard Webhooks: reject deliveries signed more than five minutes away.
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60
// Granola retries for four days; outlive that.
const DELIVERY_DEDUP_TTL_SECONDS = 5 * 24 * 60 * 60
// One "Meeting notes ready" per meeting, whichever event announced it.
const MEETING_DEDUP_TTL_SECONDS = 30 * 24 * 60 * 60
const TRANSCRIPT_EVENT_MAX = 30_000
const SUMMARY_EVENT_MAX = 12_000

const NEW_MEETING_EVENTS = new Set(["note.generated", "note.access_granted"])

type GranolaEvent = {
  event_id?: string
  event_type?: string
  note_id?: string
}

function verifySignature(
  raw: string,
  headers: { id: string; timestamp: string; signature: string },
  secret: string
): boolean {
  const seconds = Number(headers.timestamp)
  if (
    !Number.isFinite(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > TIMESTAMP_TOLERANCE_SECONDS
  ) {
    return false
  }
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${raw}`, "utf8")
    .digest()
  // The header lists one or more space-separated `v1,<base64>` signatures.
  return headers.signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2)
    if (version !== "v1" || !value) return false
    const given = Buffer.from(value, "base64")
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

async function hasEnabledListener(connectionId: string): Promise<boolean> {
  const row = await db
    .select({ id: schema.connectorTrigger.id })
    .from(schema.connectorTrigger)
    .where(
      and(
        eq(schema.connectorTrigger.connectionId, connectionId),
        eq(schema.connectorTrigger.event, "meeting_ready"),
        eq(schema.connectorTrigger.enabled, true)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  return !!row
}

// Redis trouble → proceed: a duplicate beats a dropped event.
async function claim(key: string, ttl: number): Promise<boolean> {
  try {
    const redis = await getRedisClient()
    return (await redis.set(key, "1", { NX: true, EX: ttl })) === "OK"
  } catch (err) {
    logger.warn({ err, key }, "Granola webhook dedup unavailable")
    return true
  }
}

async function release(key: string): Promise<void> {
  try {
    const redis = await getRedisClient()
    await redis.del(key)
  } catch (err) {
    logger.warn({ err, key }, "Failed to release Granola claim")
  }
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text

// "retry" → 503 so Granola redelivers; "skip" → nothing to announce.
async function meetingReady(
  connection: { id: string; externalId: string },
  noteId: string
): Promise<"retry" | "skip" | (() => Promise<unknown>)> {
  const res = await fetchGranolaNote(
    connection.externalId,
    noteId,
    true,
    TRANSCRIPT_EVENT_MAX
  )
  if (!res.ok) return res.status === 404 ? "skip" : "retry"
  const note = res.data
  if (note.deleted_at) return "skip"

  const title =
    note.title?.trim() ||
    note.calendar_event?.event_title?.trim() ||
    "Untitled meeting"
  const url = note.web_url ?? null
  const owner = note.owner?.name ?? note.owner?.email ?? null
  const minutes = granolaMinutes(note)
  const participants = granolaAttendees(note)
  const summary = clip(
    note.summary_markdown?.trim() || note.summary_text?.trim() || "",
    SUMMARY_EVENT_MAX
  )
  const transcript = note.transcript?.length
    ? formatGranolaTranscript(note.transcript, owner, TRANSCRIPT_EVENT_MAX)
    : ""
  const link = url ? `[${title}](${url})` : title

  return () =>
    dispatchConnectorEvent({
      provider: "granola",
      externalId: connection.externalId,
      event: "meeting_ready",
      label: "Granola",
      text: `**Meeting notes ready** ${link}${minutes ? ` — ${minutes} min` : ""}`,
      embeds: [
        {
          ...granolaNotificationEmbed({
            event: "Meeting notes ready",
            title,
            url,
            fields: minutes
              ? [{ name: "Duration", value: `${minutes} min`, inline: true }]
              : undefined,
          }),
          meeting: {
            meetingId: note.id,
            recordingId: note.id,
            durationMinutes: minutes ?? 0,
            participants,
            // The card's transcript; with transcripts turned off over the
            // API, Granola's own notes stand in.
            transcript: transcript || summary,
            transcriptTruncated:
              !transcript || transcript.length >= TRANSCRIPT_EVENT_MAX,
            followUps: [],
          },
        },
      ],
      item: {
        title,
        url,
        author: owner,
        content: [
          participants.length > 0
            ? `Attendees: ${participants.join(", ")}`
            : null,
          summary ? `Notes:\n${summary}` : null,
          transcript ? `Transcript:\n${transcript}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      } satisfies EventItem,
      ingested: true,
    })
}

// Plain (non-OpenAPI) route: needs the raw body for the signature, and is
// authenticated by it. The path names the connection by its key fingerprint.
granolaRouter.post("/integrations/granola/webhook/:externalId", async (c) => {
  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    logger.error(
      "INTEGRATION_ENCRYPTION_KEY not set; rejecting Granola webhook"
    )
    return c.json({ ok: false }, 503)
  }
  if (Number(c.req.header("content-length") ?? 0) > MAX_WEBHOOK_BYTES) {
    return c.json({ ok: false }, 413)
  }
  const raw = await c.req.text()
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) {
    return c.json({ ok: false }, 413)
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
        eq(schema.integrationConnection.provider, "granola"),
        eq(schema.integrationConnection.externalId, c.req.param("externalId")),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  // 404 is permanent for Granola, so a disconnected workspace stops retrying.
  if (!connection?.webhookSecret) return c.json({ ok: false }, 404)

  let secret: string
  try {
    secret = decryptSecret(
      connection.webhookSecret,
      env.INTEGRATION_ENCRYPTION_KEY
    )
  } catch (err) {
    logger.error({ err }, "Granola webhook secret decryption failed")
    return c.json({ ok: false }, 500)
  }
  const headers = {
    id: c.req.header("webhook-id") ?? "",
    timestamp: c.req.header("webhook-timestamp") ?? "",
    signature: c.req.header("webhook-signature") ?? "",
  }
  if (!(headers.id && verifySignature(raw, headers, secret))) {
    return c.json({ ok: false }, 401)
  }

  let event: GranolaEvent
  try {
    event = JSON.parse(raw) as GranolaEvent
  } catch {
    return c.json({ ok: false }, 400)
  }
  const noteId = event.note_id
  if (typeof noteId !== "string" || !noteId) return c.json({ ok: true })

  const deliveryKey = `lor:granola:webhook:${headers.id}`
  if (!(await claim(deliveryKey, DELIVERY_DEDUP_TTL_SECONDS))) {
    return c.json({ ok: true })
  }

  // Ingestion first, whether or not anyone listens; its failure is retried.
  try {
    await enqueueSourceIngest(
      connection.id,
      GRANOLA_MEETING_KIND,
      granolaNoteKey(noteId)
    )
  } catch (err) {
    logger.error({ err }, "Granola ingestion enqueue failed")
    await release(deliveryKey)
    return c.json({ ok: false, retry: true }, 503)
  }

  if (!NEW_MEETING_EVENTS.has(event.event_type ?? "")) {
    return c.json({ ok: true })
  }
  // No listener = event off; skip before spending API calls on the fetch.
  if (!(await hasEnabledListener(connection.id))) return c.json({ ok: true })

  const meetingKey = `lor:granola:meeting:${connection.id}:${granolaNoteKey(noteId)}`
  if (!(await claim(meetingKey, MEETING_DEDUP_TTL_SECONDS))) {
    return c.json({ ok: true })
  }
  const retry = async () => {
    await Promise.all([release(deliveryKey), release(meetingKey)])
    return c.json({ ok: false, retry: true }, 503)
  }
  try {
    const outcome = await meetingReady(connection, noteId)
    if (outcome === "retry") return retry()
    // Not readable yet (or gone): a later event for it may still announce it.
    if (outcome === "skip") await release(meetingKey)
    else await outcome()
  } catch (err) {
    logger.error({ err }, "Granola webhook processing failed")
    return retry()
  }
  return c.json({ ok: true })
})

export default granolaRouter
