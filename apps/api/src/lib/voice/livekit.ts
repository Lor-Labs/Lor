import { env } from "@repo/env/server"
import { AccessToken } from "livekit-server-sdk"

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
