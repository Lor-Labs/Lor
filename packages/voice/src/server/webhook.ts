import type { WebhookEvent } from "livekit-server-sdk"
import {
  markParticipantConnected,
  markParticipantLeft,
  markSessionEmpty,
} from "./participants"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Room names are session ids and identities are participant ids; anything
// else (transcriber agents, foreign rooms) matches no row. Events apply in
// arrival order and are idempotent; the voice sync job corrects reordering.
export async function applyLiveKitEvent(event: WebhookEvent) {
  const sessionId = event.room?.name
  if (!sessionId || !UUID_PATTERN.test(sessionId)) return
  const identity = event.participant?.identity
  const participantId =
    identity && UUID_PATTERN.test(identity) ? identity : undefined

  switch (event.event) {
    case "participant_joined": {
      if (!participantId) return
      const joinedAtMs = Number(event.participant?.joinedAtMs ?? 0)
      await markParticipantConnected(
        sessionId,
        participantId,
        joinedAtMs > 0 ? new Date(joinedAtMs) : new Date()
      )
      return
    }
    case "participant_left":
      if (!participantId) return
      await markParticipantLeft(sessionId, { participantId })
      return
    case "room_finished":
      await markSessionEmpty(sessionId)
      return
  }
}
