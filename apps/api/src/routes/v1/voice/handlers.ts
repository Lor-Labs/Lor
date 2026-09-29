import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { createJoinToken, getLiveKitConfig } from "@/lib/voice/livekit"
import type { JoinVoiceChannelRoute } from "@/routes/v1/voice/routes"

// V0 spike: the room is the channel and the identity is the user. V1 moves
// both to voice_session / voice_session_participant IDs.
export const joinVoiceChannel: AppRouteHandler<JoinVoiceChannelRoute> = async (
  c
) => {
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")

  const result = await resolveChannelAccess(currentUser.id, channelId)
  if (!result.ok) {
    return c.json(
      { success: false as const, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const { channel, canWrite } = result.access
  if (channel.type !== "voice") {
    return c.json(
      { success: false as const, message: "Not a voice channel" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (!canWrite) {
    return c.json(
      { success: false as const, message: "This channel is archived" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const livekit = getLiveKitConfig()
  if (!livekit) {
    return c.json(
      { success: false as const, message: "Voice is not configured" },
      HttpStatusCodes.SERVICE_UNAVAILABLE
    )
  }

  const token = await createJoinToken(livekit, {
    room: channel.id,
    identity: currentUser.id,
    name: currentUser.name,
  })
  return c.json({ url: livekit.url, token }, HttpStatusCodes.OK)
}
