import { Webhooks } from "@octokit/webhooks"
import { env } from "@repo/env/server"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"
import { registerGithubHandlers } from "@/routes/v1/integrations/github/events"

const githubRouter = createRouter()

// Cap the (unauthenticated) webhook body. Our salient events are well under
// this; GitHub's own max is ~25MB. Guards against oversized-payload abuse.
const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024
// Long enough to cover a redelivery; the id is a uuid, so keys don't collide.
const DELIVERY_DEDUP_TTL_SECONDS = 24 * 60 * 60

// One Webhooks instance; handlers registered once. Null when the secret is
// unset (only the webhook path needs it) — the route then 503s.
const webhooks = env.GITHUB_WEBHOOK_SECRET
  ? new Webhooks({ secret: env.GITHUB_WEBHOOK_SECRET })
  : null
if (webhooks) registerGithubHandlers(webhooks)

// Plain (non-OpenAPI) route: the webhook needs the raw body for signature
// verification, and it's authenticated by the signature, not a session.
githubRouter.post("/integrations/github/webhook", async (c) => {
  if (!webhooks) {
    logger.error("GITHUB_WEBHOOK_SECRET not set; rejecting webhook")
    return c.json({ ok: false }, 503)
  }

  if (Number(c.req.header("content-length") ?? 0) > MAX_WEBHOOK_BYTES) {
    return c.json({ ok: false }, 413)
  }

  const raw = await c.req.text()
  const signature = c.req.header("x-hub-signature-256") ?? ""
  if (!(await webhooks.verify(raw, signature))) {
    return c.json({ ok: false }, 401)
  }

  // GitHub can redeliver (retries, or a manual replay from the App settings) and
  // handlers post channel messages, so claim the delivery id before processing.
  // Redis trouble → proceed: a duplicate notification beats a dropped event.
  const deliveryId = c.req.header("x-github-delivery") ?? ""
  const deliveryKey = deliveryId ? `lor:github:webhook:${deliveryId}` : null
  if (deliveryKey) {
    try {
      const redis = await getRedisClient()
      const first = await redis.set(deliveryKey, "1", {
        NX: true,
        EX: DELIVERY_DEDUP_TTL_SECONDS,
      })
      if (first !== "OK") return c.json({ ok: true })
    } catch (err) {
      logger.warn({ err, deliveryId }, "GitHub webhook dedup unavailable")
    }
  }

  // Ack immediately
  const name = c.req.header("x-github-event") ?? ""
  void webhooks
    .verifyAndReceive({
      id: deliveryId,
      name: name as Parameters<typeof webhooks.verifyAndReceive>[0]["name"],
      payload: raw,
      signature,
    })
    .catch(async (err) => {
      logger.error({ err, name }, "GitHub webhook failed")
      // Dispatch failed, so the claim would otherwise swallow the operator's
      // manual redelivery — the only recovery path once we've acked.
      if (!deliveryKey) return
      try {
        const redis = await getRedisClient()
        await redis.del(deliveryKey)
      } catch (releaseErr) {
        logger.warn(
          { err: releaseErr, deliveryId },
          "Failed to release GitHub webhook claim"
        )
      }
    })

  return c.json({ ok: true })
})

export default githubRouter
