import { LinearWebhookClient } from "@linear/sdk/webhooks"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { postConnectorNotification } from "@/lib/connector-notifications"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"

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
  data?: {
    title?: string | null
    identifier?: string | null
    state?: { type?: string | null; name?: string | null } | null
  } | null
  // Previous values of changed fields — presence of stateId means the state
  // transitioned in this event.
  updatedFrom?: Record<string, unknown> | null
}

// Issue created / issue completed → notify channel (when configured on the
// connection). Best-effort: a notification hiccup shouldn't make Linear
// retry the delivery.
async function notifyIssueEvent(event: LinearEvent): Promise<void> {
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
  try {
    await postConnectorNotification({
      provider: "linear",
      externalId: event.organizationId,
      event: kind,
      label: "Linear",
      text: `**Issue ${kind === "issue_created" ? "created" : "completed"}** ${link}`,
    })
  } catch (err) {
    logger.error({ err }, "Linear issue notification failed")
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

  await notifyIssueEvent(event)

  return c.json({ ok: true })
})

export default linearRouter
