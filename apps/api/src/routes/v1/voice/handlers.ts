import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { createJoinToken, getLiveKitConfig } from "@/lib/voice/livekit"
import {
  countConnectedParticipants,
  getOrCreateLiveSession,
  isSessionFull,
  leaveOtherCalls,
  markParticipantLeft,
  upsertParticipant,
} from "@/lib/voice/sessions"
import type {
  JoinVoiceChannelRoute,
  LeaveVoiceSessionRoute,
} from "@/routes/v1/voice/routes"

// Only touches the caller's own participant row, so no channel check is
// needed: a stranger's sessionId matches nothing.
export const leaveVoiceSession: AppRouteHandler<
  LeaveVoiceSessionRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  await markParticipantLeft(sessionId, c.var.user.id)
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

// The LiveKit room is the session id and the identity is the participant id.
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

  const { workspaceId } = channel
  if (!workspaceId) {
    return c.json(
      { success: false as const, message: "Not a voice channel" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const session = await getOrCreateLiveSession(
    { id: channel.id, workspaceId },
    currentUser.id
  )
  const connectedOthers = await countConnectedParticipants(
    session.id,
    currentUser.id
  )
  if (isSessionFull(connectedOthers)) {
    return c.json(
      { success: false as const, message: "This call is full" },
      HttpStatusCodes.CONFLICT
    )
  }

  await leaveOtherCalls(livekit, currentUser.id, session.id)
  const participantId = await upsertParticipant(session.id, currentUser.id)
  const token = await createJoinToken(livekit, {
    room: session.id,
    identity: participantId,
    name: currentUser.name,
  })
  return c.json(
    { url: livekit.url, token, sessionId: session.id, participantId },
    HttpStatusCodes.OK
  )
}
