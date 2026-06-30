import { LinearWebhookClient } from "@linear/sdk/webhooks"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"

const linearRouter = createRouter()

const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024

// One client; null when the secret is unset — the route then 503s.
const webhook = env.LINEAR_WEBHOOK_SECRET
  ? new LinearWebhookClient(env.LINEAR_WEBHOOK_SECRET)
  : null

// The fields we act on, narrowed from the broad LinearWebhookPayload union.
type LinearEvent = { type?: string; action?: string; organizationId?: string }

// Plain route: the webhook needs the raw body for signature verification and is
// authenticated by the signature, not a session.
linearRouter.post("/integrations/linear/webhook", async (c) => {
  if (!webhook) {
    logger.error("LINEAR_WEBHOOK_SECRET not set; rejecting webhook")
    return c.json({ ok: false }, 503)
  }

  if (Number(c.req.header("content-length") ?? 0) > MAX_WEBHOOK_BYTES) {
    return c.json({ ok: false }, 413)
  }

  const raw = await c.req.text()
  const signature = c.req.header("linear-signature") ?? ""
  const timestamp = c.req.header("linear-timestamp")
  let event: LinearEvent
  try {
    event = webhook.parseData(Buffer.from(raw), signature, timestamp)
  } catch (err) {
    logger.warn({ err }, "Linear webhook verification failed")
    return c.json({ ok: false }, 401)
  }

  // Lifecycle: revoking the OAuth app drops the connection (sources cascade).
  // Fire-and-forget so we ack immediately.
  if (
    event.type === "OAuthApp" &&
    event.action === "revoked" &&
    event.organizationId
  ) {
    const organizationId = event.organizationId
    void db
      .delete(schema.integrationConnection)
      .where(
        and(
          eq(schema.integrationConnection.provider, "linear"),
          eq(schema.integrationConnection.externalId, organizationId)
        )
      )
      .then(() =>
        logger.info(
          { organizationId },
          "Linear OAuth app revoked; connection removed"
        )
      )
      .catch((err) =>
        logger.error({ err }, "Linear OAuth app revoke handling failed")
      )
  }

  return c.json({ ok: true })
})

export default linearRouter
