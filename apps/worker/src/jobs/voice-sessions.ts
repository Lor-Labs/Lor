import {
  auditLiveSessions,
  endExpiredSessions,
  endInactiveBetaSessions,
  getLiveKitConfig,
} from "@repo/voice/server"
import { queueMissedCallMemory } from "@/jobs/voice-session-memory"
import { logger } from "@/lib/logger"

// Webhooks keep voice state current; these sweeps are the backstop. They stay
// cheap on LiveKit's 1,000 requests/minute server API limit: the 30s sweep
// only calls LiveKit for sessions about to end, and the audit checks each
// live session once per 10 minutes.
export const VOICE_SESSION_SWEEP_EVERY_MS = 30_000
export const VOICE_SESSION_AUDIT_EVERY_MS = 10 * 60_000

export async function sweepVoiceSessions() {
  const livekit = getLiveKitConfig()
  if (!livekit) return

  const beta = await endInactiveBetaSessions(livekit)
  for (const { sessionId, err } of beta.failed) {
    logger.warn(
      { err, sessionId },
      "voice: could not end an inactive beta call"
    )
  }
  const { ended, failed } = await endExpiredSessions(livekit)
  if (ended.length > 0) logger.info({ ended }, "voice: sessions ended")
  for (const { sessionId, err } of failed) {
    logger.warn({ err, sessionId }, "voice: could not confirm session is empty")
  }
}

export async function auditVoiceSessions() {
  const livekit = getLiveKitConfig()
  if (!livekit) return

  const { dispatched, failed } = await auditLiveSessions(livekit)
  if (dispatched.length > 0) {
    logger.warn({ dispatched }, "voice: transcriber missing, dispatched")
  }
  for (const { sessionId, err } of failed) {
    logger.warn({ err, sessionId }, "voice: session audit failed")
  }
  await queueMissedCallMemory().catch((err) =>
    logger.warn({ err }, "voice: could not queue missed call memory")
  )
}
