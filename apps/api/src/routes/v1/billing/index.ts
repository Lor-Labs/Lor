import { env } from "@repo/env/server"
import type { BillingUpdatedEvent } from "@repo/realtime-types"
import { type ServerToClientEvents, workspaceRoom } from "@repo/realtime-types"
import { Emitter } from "@socket.io/redis-emitter"
import { Webhook } from "svix"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"
import * as handlers from "@/routes/v1/billing/handlers"
import * as routes from "@/routes/v1/billing/routes"

const billingRouter = createRouter()
  .openapi(routes.getBilling, handlers.getBilling)
  .openapi(routes.subscribe, handlers.subscribe)
  .openapi(routes.topup, handlers.topup)
  .openapi(routes.setAutoTopup, handlers.setAutoTopupHandler)
  .openapi(routes.portal, handlers.portal)

let emitter: Emitter<ServerToClientEvents> | null = null

async function getEmitter() {
  const redis = await getRedisClient()
  if (!emitter) {
    emitter = new Emitter<ServerToClientEvents>(redis)
  }
  return emitter
}

const webhookVerifier = env.AUTUMN_WEBHOOK_SECRET
  ? new Webhook(env.AUTUMN_WEBHOOK_SECRET)
  : null

// Autumn's exact wire `type` strings aren't documented; match on normalized
// substrings so snake/camel/dot variants all map. Verify against a sandbox
// test event before launch.
function mapEventReason(type: string): BillingUpdatedEvent["reason"] | null {
  const t = type.toLowerCase().replace(/[^a-z]/g, "_")
  if (t.includes("topup") || t.includes("top_up")) {
    return t.includes("fail") ? "auto_topup_failed" : "auto_topup_succeeded"
  }
  if (t.includes("limit_reached") || t.includes("usage_alert")) {
    return "low_balance"
  }
  if (t.includes("billing_updated") || t.includes("plan")) {
    return "subscription_changed"
  }
  return null
}

// Plain (non-OpenAPI) route: needs the raw body for Svix signature
// verification, and it's authenticated by the signature, not a session.
billingRouter.post("/billing/webhook", async (c) => {
  if (!webhookVerifier) {
    logger.error("AUTUMN_WEBHOOK_SECRET not set; rejecting webhook")
    return c.json({ ok: false }, 503)
  }

  const raw = await c.req.text()
  let event: { type?: string; data?: { customer_id?: string } }
  try {
    webhookVerifier.verify(raw, {
      "svix-id": c.req.header("svix-id") ?? "",
      "svix-timestamp": c.req.header("svix-timestamp") ?? "",
      "svix-signature": c.req.header("svix-signature") ?? "",
    })
    event = JSON.parse(raw)
  } catch (err) {
    logger.warn({ err }, "Autumn webhook verification failed")
    return c.json({ ok: false }, 401)
  }

  const reason = mapEventReason(event.type ?? "")
  const workspaceId = event.data?.customer_id
  if (reason && workspaceId) {
    // Ack fast; the emit is best-effort fan-out to open clients.
    void getEmitter()
      .then((io) =>
        io
          .to(workspaceRoom(workspaceId))
          .emit("billing:updated", { workspaceId, reason })
      )
      .catch((err) =>
        logger.error({ err, workspaceId }, "billing:updated emit failed")
      )
  } else {
    logger.info({ type: event.type }, "Autumn webhook ignored")
  }

  return c.json({ ok: true })
})

export default billingRouter
