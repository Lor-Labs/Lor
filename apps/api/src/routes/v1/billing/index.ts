import {
  sendAutoTopupChargedEmail,
  sendAutoTopupFailedEmail,
} from "@repo/billing"
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
import { entitlements, entitlementsHandler } from "./entitlements"
import * as inference from "./inference"

const billingRouter = createRouter()
  .openapi(entitlements, entitlementsHandler)
  .openapi(inference.getInference, inference.getInferenceHandler)
  .openapi(inference.putInference, inference.putInferenceHandler)
  .openapi(inference.deleteInference, inference.deleteInferenceHandler)
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
  const svixId = c.req.header("svix-id") ?? ""
  let event: {
    type?: string
    data?: {
      customer_id?: string
      quantity_granted?: number
      reason?: string
    }
  }
  try {
    event = webhookVerifier.verify(raw, {
      "svix-id": svixId,
      "svix-timestamp": c.req.header("svix-timestamp") ?? "",
      "svix-signature": c.req.header("svix-signature") ?? "",
    }) as typeof event
  } catch (err) {
    logger.warn({ err }, "Autumn webhook verification failed")
    return c.json({ ok: false }, 401)
  }

  // Svix retries deliveries; dedupe by message id so a retry can't repeat
  // the email/toast side effects. TTL outlives Svix's ~28h retry schedule.
  // Redis trouble → proceed (a duplicate toast beats a dropped event).
  if (svixId) {
    try {
      const redis = await getRedisClient()
      const first = await redis.set(`lor:billing:webhook:${svixId}`, "1", {
        NX: true,
        EX: 48 * 60 * 60,
      })
      if (first !== "OK") return c.json({ ok: true })
    } catch (err) {
      logger.warn({ err, svixId }, "Webhook dedup unavailable; proceeding")
    }
  }

  const reason = mapEventReason(event.type ?? "")
  const workspaceId = event.data?.customer_id
  if (reason && workspaceId) {
    // Ack fast; emits and emails are best-effort side effects.
    void getEmitter()
      .then((io) =>
        io
          .to(workspaceRoom(workspaceId))
          .emit("billing:updated", { workspaceId, reason })
      )
      .catch((err) =>
        logger.error({ err, workspaceId }, "billing:updated emit failed")
      )
    // Auto top-ups charge the owner's card without them acting — email them.
    if (reason === "auto_topup_succeeded" && event.data?.quantity_granted) {
      void sendAutoTopupChargedEmail(
        workspaceId,
        event.data.quantity_granted
      ).catch((err) =>
        logger.error({ err, workspaceId }, "Auto top-up receipt email failed")
      )
    } else if (reason === "auto_topup_failed") {
      void sendAutoTopupFailedEmail(workspaceId, event.data?.reason).catch(
        (err) =>
          logger.error({ err, workspaceId }, "Auto top-up failure email failed")
      )
    }
  } else {
    logger.info({ type: event.type }, "Autumn webhook ignored")
  }

  return c.json({ ok: true })
})

export default billingRouter
