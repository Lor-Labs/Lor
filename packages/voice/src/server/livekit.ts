import { readServerEnv } from "@repo/env/server-fields"
import {
  AccessToken,
  AgentDispatchClient,
  RoomAgentDispatch,
  RoomConfiguration,
  RoomServiceClient,
  ServerError,
  WebhookReceiver,
} from "livekit-server-sdk"
import { TRANSCRIBER_AGENT_NAME } from "../index"

const env = readServerEnv(
  "NODE_ENV",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET"
)

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

// Laptops may share production's LiveKit project, so a local transcriber
// registers, and local tokens dispatch, under a separate agent name.
export function transcriberAgentName() {
  return env.NODE_ENV === "production"
    ? TRANSCRIBER_AGENT_NAME
    : `${TRANSCRIBER_AGENT_NAME}-dev`
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
    if (err instanceof ServerError && err.status === 404) return
    throw err
  }
}

export function createJoinToken(
  config: LiveKitConfig,
  input: { room: string; identity: string; name: string; expiresAt?: Date }
) {
  const ttl = input.expiresAt
    ? Math.min(600, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000))
    : 600
  if (ttl < 1) throw new Error("This workspace beta has ended")
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: input.identity,
    name: input.name,
    ttl,
  })
  token.addGrant({
    room: input.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  })
  // LiveKit applies this only when the token's join creates the room.
  token.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: transcriberAgentName() })],
  })
  return token.toJwt()
}

// Token dispatch fires only when LiveKit creates the room, so a live room
// that lost its transcriber gets a new one this way.
export function dispatchTranscriber(config: LiveKitConfig, room: string) {
  return new AgentDispatchClient(
    config.url,
    config.apiKey,
    config.apiSecret
  ).createDispatch(room, transcriberAgentName())
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
