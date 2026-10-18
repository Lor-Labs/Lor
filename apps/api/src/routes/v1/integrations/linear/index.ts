import { LinearWebhookClient } from "@linear/sdk/webhooks"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { tombstoneSource } from "@repo/lor/sources"
import { linearNotificationEmbed } from "@/lib/connector-notification-embeds"
import { dispatchConnectorEvent } from "@/lib/connector-triggers"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"
import {
  enqueueSourceIngest,
  ingestConnection,
} from "@/lib/source-ingest-queue"

const linearRouter = createRouter()

const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024

// One client; null when the secret is unset — the route then 503s.
const webhook = env.LINEAR_WEBHOOK_SECRET
  ? new LinearWebhookClient(env.LINEAR_WEBHOOK_SECRET)
  : null

// The fields we act on, narrowed from the broad LinearWebhookPayload union.
type LinearEvent = {
  type?: string
  action?: string
  organizationId?: string
  // Issue URL for Issue events.
  url?: string | null
  actor?: {
    name?: string | null
    url?: string | null
    avatarUrl?: string | null
  } | null
  data?: {
    id?: string | null
    title?: string | null
    identifier?: string | null
    // Comment events: the issue the comment belongs to, when it has one.
    issueId?: string | null
    issue?: { identifier?: string | null } | null
    description?: string | null
    state?: { type?: string | null; name?: string | null } | null
    creator?: {
      name?: string | null
      url?: string | null
      avatarUrl?: string | null
    } | null
  } | null
  // Previous values of changed fields — presence of stateId means the state
  // transitioned in this event.
  updatedFrom?: Record<string, unknown> | null
}

// Issue created / issue completed → the trigger's configured effects (when one
// exists on the connection). Best-effort: a dispatch hiccup shouldn't make
// Linear retry the delivery.
async function dispatchIssueEvent(event: LinearEvent): Promise<void> {
  if (event.type !== "Issue" || !event.organizationId || !event.data?.title) {
    return
  }
  const completed =
    event.action === "update" &&
    !!event.updatedFrom &&
    "stateId" in event.updatedFrom &&
    event.data.state?.type === "completed"
  const kind =
    event.action === "create"
      ? ("issue_created" as const)
      : completed
        ? ("issue_completed" as const)
        : null
  if (!kind) return

  const ref = event.data.identifier
    ? `${event.data.identifier} ${event.data.title}`
    : event.data.title
  const link = event.url ? `[${ref}](${event.url})` : ref
  const eventLabel = `Issue ${kind === "issue_created" ? "created" : "completed"}`
  const rawActor = event.actor?.name ? event.actor : event.data.creator
  const actor = rawActor?.name
    ? {
        name: rawActor.name,
        url: rawActor.url,
        avatarUrl: rawActor.avatarUrl,
      }
    : null
  try {
    await dispatchConnectorEvent({
      provider: "linear",
      externalId: event.organizationId,
      event: kind,
      label: "Linear",
      text: `**${eventLabel}** ${link}`,
      embeds: [
        linearNotificationEmbed({
          event: eventLabel,
          title: event.data.title,
          url: event.url,
          identifier: event.data.identifier,
          body: event.data.description,
          actor,
        }),
      ],
      item: {
        title: event.data.title,
        url: event.url ?? null,
        author: null,
        content: `${event.data.title}\n\n${event.data.description ?? ""}`,
      },
      ingested: true,
    })
  } catch (err) {
    logger.error({ err }, "Linear issue event dispatch failed")
  }
}

// Ingestion runs whether or not a trigger exists: an issue change or any
// comment on it refetches the issue; a removed issue is tombstoned. Best-effort:
// the catch-up sweep covers a miss. reference/planned/context-engine-phase-2.md.
async function ingestIssueEvent(event: LinearEvent): Promise<void> {
  if (!event.organizationId) return
  const ref =
    event.type === "Issue"
      ? (event.data?.identifier ?? event.data?.id)
      : event.type === "Comment"
        ? (event.data?.issue?.identifier ?? event.data?.issueId)
        : null
  if (!ref) return
  try {
    const connection = await ingestConnection("linear", event.organizationId)
    if (!connection) return
    if (event.type === "Issue" && event.action === "remove") {
      if (event.data?.identifier) {
        await tombstoneSource(connection.id, event.data.identifier)
      }
      return
    }
    await enqueueSourceIngest(connection.id, "issue", ref)
  } catch (err) {
    logger.error({ err }, "Linear ingestion enqueue failed")
  }
}

// Plain route: the webhook needs the raw body for signature verification and is
// authenticated by the signature, not a session.
linearRouter.post("/integrations/linear/webhook", async (c) => {
  if (!webhook) {
    logger.error("LINEAR_WEBHOOK_SECRET not set; rejecting webhook")
    return c.json({ ok: false }, 503)
  }

  // content-length is a cheap early-out but can be absent or lie; enforce the
  // real size against the buffered body below too.
  if (Number(c.req.header("content-length") ?? 0) > MAX_WEBHOOK_BYTES) {
    return c.json({ ok: false }, 413)
  }

  const raw = await c.req.text()
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) {
    return c.json({ ok: false }, 413)
  }
  const signature = c.req.header("linear-signature") ?? ""
  const timestamp = c.req.header("linear-timestamp")
  let event: LinearEvent
  try {
    // The SDK union's `data` variants share no common shape, so it can't
    // structurally narrow — assert to the fields we read (all optional).
    event = webhook.parseData(
      Buffer.from(raw),
      signature,
      timestamp
    ) as unknown as LinearEvent
  } catch (err) {
    logger.warn({ err }, "Linear webhook verification failed")
    return c.json({ ok: false }, 401)
  }

  // Lifecycle: revoking the OAuth app drops the connection (sources cascade).
  // Await the cleanup so a failure returns non-2xx and Linear retries, rather
  // than acking a delete that never landed.
  if (
    event.type === "OAuthApp" &&
    event.action === "revoked" &&
    event.organizationId
  ) {
    const organizationId = event.organizationId
    try {
      await db
        .delete(schema.integrationConnection)
        .where(
          and(
            eq(schema.integrationConnection.provider, "linear"),
            eq(schema.integrationConnection.externalId, organizationId)
          )
        )
      logger.info(
        { organizationId },
        "Linear OAuth app revoked; connection removed"
      )
    } catch (err) {
      logger.error({ err }, "Linear OAuth app revoke handling failed")
      return c.json({ ok: false }, 500)
    }
  }

  await Promise.all([dispatchIssueEvent(event), ingestIssueEvent(event)])

  return c.json({ ok: true })
})

export default linearRouter
