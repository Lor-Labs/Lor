import { createHmac, timingSafeEqual } from "node:crypto"
import { recordUsage } from "@repo/billing"
import { and, db, eq, schema } from "@repo/db"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import { env } from "@repo/env/server"
import {
  type CirclebackMeeting,
  circlebackAttendees,
  circlebackMeetingUrl,
  circlebackMinutes,
  circlebackSourceItem,
  circlebackTitle,
  formatCirclebackActionItems,
  formatCirclebackTranscript,
} from "@repo/lor/providers"
import { storeSourceItem } from "@repo/lor/sources"
import { decryptSecret } from "@repo/utils/crypto"
import { circlebackNotificationEmbed } from "@/lib/connector-notification-embeds"
import {
  dispatchConnectorEvent,
  type EventItem,
} from "@/lib/connector-triggers"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"

// Circleback webhooks (reference/circleback-connector.md): a "Send webhook
// request" step in a Circleback automation, set up by hand with the URL from
// the connector page. Signed with `X-Signature` (hex HMAC-SHA256 of the raw
// body, the step's secret pasted into Lor). Retried up to 9 times on a
// non-2xx. The payload is the whole meeting, stored as it comes: it can
// belong to anyone in a workspace automation, past the key's reach.

const circlebackRouter = createRouter()

// The payload carries the full transcript.
const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024
// One "Meeting notes ready" per meeting, however often it is sent.
const MEETING_DEDUP_TTL_SECONDS = 30 * 24 * 60 * 60
const TRANSCRIPT_EVENT_MAX = 30_000
const NOTES_EVENT_MAX = 12_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function verifySignature(raw: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest()
  const given = Buffer.from(signature.trim(), "hex")
  return given.length === expected.length && timingSafeEqual(given, expected)
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
async function claimMeeting(key: string): Promise<boolean> {
  try {
    const redis = await getRedisClient()
    return (
      (await redis.set(key, "1", {
        NX: true,
        EX: MEETING_DEDUP_TTL_SECONDS,
      })) === "OK"
    )
  } catch (err) {
    logger.warn({ err, key }, "Circleback webhook dedup unavailable")
    return true
  }
}

async function releaseMeeting(key: string): Promise<void> {
  try {
    const redis = await getRedisClient()
    await redis.del(key)
  } catch (err) {
    logger.warn({ err, key }, "Failed to release Circleback claim")
  }
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text

function announce(externalId: string, meeting: CirclebackMeeting) {
  const title = circlebackTitle(meeting)
  const url = circlebackMeetingUrl(meeting.id)
  const minutes = circlebackMinutes(meeting)
  const participants = circlebackAttendees(meeting)
  const notes = clip(meeting.notes?.trim() ?? "", NOTES_EVENT_MAX)
  const actionItems = meeting.actionItems?.length
    ? formatCirclebackActionItems(meeting.actionItems)
    : ""
  const transcript = meeting.transcript?.length
    ? formatCirclebackTranscript(meeting.transcript, TRANSCRIPT_EVENT_MAX)
    : ""
  return dispatchConnectorEvent({
    provider: "circleback",
    externalId,
    event: "meeting_ready",
    label: "Circleback",
    text: `**Meeting notes ready** [${title}](${url})${minutes ? ` — ${minutes} min` : ""}`,
    embeds: [
      {
        ...circlebackNotificationEmbed({
          event: "Meeting notes ready",
          title,
          url,
          fields: minutes
            ? [{ name: "Duration", value: `${minutes} min`, inline: true }]
            : undefined,
        }),
        meeting: {
          meetingId: meeting.id,
          recordingId: meeting.id,
          durationMinutes: minutes ?? 0,
          participants,
          // The card's transcript; with none sent, the notes stand in.
          transcript: transcript || notes,
          transcriptTruncated:
            !transcript || transcript.length >= TRANSCRIPT_EVENT_MAX,
          followUps: [],
        },
      },
    ],
    item: {
      title,
      url,
      author: null,
      content: [
        participants.length > 0
          ? `Attendees: ${participants.join(", ")}`
          : null,
        notes ? `Notes:\n${notes}` : null,
        actionItems ? `Action items:\n${actionItems}` : null,
        transcript ? `Transcript:\n${transcript}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    } satisfies EventItem,
    ingested: true,
  })
}

// Plain (non-OpenAPI) route: the raw body is needed for the signature. The
// path names the connection; the secret authenticates it.
circlebackRouter.post(
  "/integrations/circleback/webhook/:connectionId",
  async (c) => {
    if (!env.INTEGRATION_ENCRYPTION_KEY) {
      logger.error(
        "INTEGRATION_ENCRYPTION_KEY not set; rejecting Circleback webhook"
      )
      return c.json({ ok: false }, 503)
    }
    const connectionId = c.req.param("connectionId")
    if (!UUID.test(connectionId)) return c.json({ ok: false }, 404)
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
        workspaceId: schema.integrationConnection.workspaceId,
        externalId: schema.integrationConnection.externalId,
        webhookSecret: schema.integrationConnection.webhookSecret,
      })
      .from(schema.integrationConnection)
      .where(
        and(
          eq(schema.integrationConnection.id, connectionId),
          eq(schema.integrationConnection.provider, "circleback"),
          eq(schema.integrationConnection.status, "active")
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (!connection) return c.json({ ok: false }, 404)
    // No secret pasted yet: nothing to check the signature with.
    if (!connection.webhookSecret) return c.json({ ok: false }, 401)

    let secret: string
    try {
      secret = decryptSecret(
        connection.webhookSecret,
        env.INTEGRATION_ENCRYPTION_KEY
      )
    } catch (err) {
      logger.error({ err }, "Circleback webhook secret decryption failed")
      return c.json({ ok: false }, 500)
    }
    if (!verifySignature(raw, c.req.header("x-signature") ?? "", secret)) {
      return c.json({ ok: false }, 401)
    }

    let meeting: CirclebackMeeting
    try {
      meeting = JSON.parse(raw) as CirclebackMeeting
    } catch {
      return c.json({ ok: false }, 400)
    }
    if (typeof meeting?.id !== "string" || !meeting.id) {
      return c.json({ ok: false }, 400)
    }

    // Shown on the connector page, so people can tell the automation works.
    await db
      .update(schema.integrationConnection)
      .set({ webhookReceivedAt: new Date() })
      .where(eq(schema.integrationConnection.id, connection.id))

    // Stored whether or not anyone listens; a failure is retried.
    if (
      (await workspaceBetaAccess(connection.workspaceId)).state === "active"
    ) {
      const recorded: Promise<void>[] = []
      try {
        await storeSourceItem(
          {
            id: connection.id,
            workspaceId: connection.workspaceId,
            provider: "circleback",
          },
          circlebackSourceItem(meeting),
          (usage) => {
            recorded.push(recordUsage(usage))
          }
        )
      } catch (err) {
        logger.error({ err }, "Circleback meeting storage failed")
        return c.json({ ok: false, retry: true }, 503)
      } finally {
        await Promise.allSettled(recorded)
      }
    }

    // No listener = event off.
    if (!(await hasEnabledListener(connection.id))) return c.json({ ok: true })
    const meetingKey = `lor:circleback:meeting:${connection.id}:${meeting.id}`
    if (!(await claimMeeting(meetingKey))) return c.json({ ok: true })
    try {
      await announce(connection.externalId, meeting)
    } catch (err) {
      logger.error({ err }, "Circleback webhook dispatch failed")
      await releaseMeeting(meetingKey)
      return c.json({ ok: false, retry: true }, 503)
    }
    return c.json({ ok: true })
  }
)

export default circlebackRouter
