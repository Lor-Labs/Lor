import {
  applyLiveKitEvent,
  getLiveKitConfig,
  receiveWebhook,
} from "@repo/voice/server"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"
import * as handlers from "@/routes/v1/voice/handlers"
import * as routes from "@/routes/v1/voice/routes"

const voiceRouter = createRouter()
  .openapi(routes.joinVoiceChannel, handlers.joinVoiceChannel)
  .openapi(routes.leaveVoiceSession, handlers.leaveVoiceSession)
  .openapi(routes.listVoiceSessions, handlers.listVoiceSessions)
  .openapi(routes.getVoiceSession, handlers.getVoiceSession)
  .openapi(routes.getVoiceTranscript, handlers.getVoiceTranscript)
  .openapi(routes.getSummaryCard, handlers.getSummaryCard)
  .openapi(routes.updateSummaryCard, handlers.updateSummaryCard)
  .openapi(routes.listVoiceRequests, handlers.listVoiceRequests)
  .openapi(routes.cancelVoiceRequest, handlers.cancelVoiceRequest)
  .openapi(routes.dismissVoiceRequest, handlers.dismissVoiceRequest)
  .openapi(routes.chooseVoiceRequest, handlers.chooseVoiceRequest)
  .openapi(routes.getVoiceRequestEntities, handlers.getVoiceRequestEntities)
  .openapi(routes.stageVoiceRequest, handlers.stageVoiceRequest)
  .openapi(routes.getVoicePresence, handlers.getVoicePresence)
  .openapi(routes.getVoiceCall, handlers.getVoiceCall)
  .openapi(routes.removeVoiceParticipant, handlers.removeVoiceParticipant)

const MAX_WEBHOOK_BYTES = 1024 * 1024

// Plain route: signature verification needs the raw body, and LiveKit
// authenticates with a signed Authorization header, not a session.
voiceRouter.post("/voice/livekit/webhook", async (c) => {
  const livekit = getLiveKitConfig()
  if (!livekit) return c.json({ ok: false }, 503)

  if (Number(c.req.header("content-length") ?? 0) > MAX_WEBHOOK_BYTES) {
    return c.json({ ok: false }, 413)
  }
  const raw = await c.req.text()
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) {
    return c.json({ ok: false }, 413)
  }

  const event = await receiveWebhook(
    livekit,
    raw,
    c.req.header("authorization")
  ).catch((err: unknown) => {
    logger.warn({ err }, "voice: rejected LiveKit webhook")
    return null
  })
  if (!event) return c.json({ ok: false }, 401)

  await applyLiveKitEvent(event)
  return c.json({ ok: true })
})

export default voiceRouter
