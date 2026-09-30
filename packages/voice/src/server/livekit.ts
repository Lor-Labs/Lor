import { env } from "@repo/env/server"
import {
  AccessToken,
  RoomServiceClient,
  TwirpError,
  WebhookReceiver,
} from "livekit-server-sdk"

export type LiveKitConfig = {
  url: string
  apiKey: string
  apiSecret: string
}

export function getLiveKitConfig(): LiveKitConfig | null {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return null
  return {
    url: LIVEKIT_URL,
    apiKey: LIVEKIT_API_KEY,
    apiSecret: LIVEKIT_API_SECRET,
  }
}

export function getRoomService(config: LiveKitConfig) {
  return new RoomServiceClient(config.url, config.apiKey, config.apiSecret)
}

// Resolves once the participant is out of the room, including when LiveKit
// already dropped them or closed the room.
export async function removeFromRoom(
  config: LiveKitConfig,
  room: string,
  identity: string
) {
  try {
    await getRoomService(config).removeParticipant(room, identity)
  } catch (err) {
    if (err instanceof TwirpError && err.status === 404) return
    throw err
  }
}

export function createJoinToken(
  config: LiveKitConfig,
  input: { room: string; identity: string; name: string }
) {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: input.identity,
    name: input.name,
    ttl: "10m",
  })
  token.addGrant({
    room: input.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  })
  return token.toJwt()
}

// Throws when the Authorization signature doesn't match the raw body.
export function receiveWebhook(
  config: LiveKitConfig,
  body: string,
  authHeader: string | undefined
) {
  return new WebhookReceiver(config.apiKey, config.apiSecret).receive(
    body,
    authHeader
  )
}
