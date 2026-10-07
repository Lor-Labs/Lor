// How long a voice session waits after the last person leaves before it
// ends; a rejoin inside this window continues the same session.
export const VOICE_SESSION_GRACE_MS = 120_000

// Matches the largest team size Lor currently targets.
export const MAX_CALL_PARTICIPANTS = 30

// The transcriber's agent name; join tokens dispatch it to each new room.
export const TRANSCRIBER_AGENT_NAME = "lor-transcriber"

export {
  CAPTION_ATTRIBUTES,
  CAPTION_TOPIC,
} from "@repo/realtime-types/call-transcript"
