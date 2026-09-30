import {
  listAccessibleChannelIds,
  resolveChannelAccess,
} from "@repo/db/queries/channel-access"
import {
  countConnectedParticipants,
  createJoinToken,
  getCurrentCall,
  getLiveKitConfig,
  markParticipantLeft,
  removeFromRoom,
} from "@repo/voice/server"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspaceAuthority } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import {
  getSessionSummary,
  listSessionHistory,
  listWorkspacePresence,
} from "@/lib/voice/queries"
import {
  findSessionScope,
  getOrCreateLiveSession,
  isSessionFull,
  leaveOtherCalls,
  upsertParticipant,
} from "@/lib/voice/sessions"
import type {
  GetVoiceCallRoute,
  GetVoicePresenceRoute,
  GetVoiceSessionRoute,
  JoinVoiceChannelRoute,
  LeaveVoiceSessionRoute,
  ListVoiceSessionsRoute,
  RemoveVoiceParticipantRoute,
} from "@/routes/v1/voice/routes"

export const removeVoiceParticipant: AppRouteHandler<
  RemoveVoiceParticipantRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { voice: ["moderate"] })
  const { sessionId, participantId } = c.req.valid("param")

  const scope = await findSessionScope(sessionId)
  const access =
    scope && scope.workspaceId === c.var.workspace.id && !scope.endedAt
      ? await resolveChannelAccess(c.var.user.id, scope.channelId)
      : null
  if (!access?.ok) {
    return c.json(
      { success: false as const, message: "Session not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const livekit = getLiveKitConfig()
  if (!livekit) {
    return c.json(
      { success: false as const, message: "Voice is not configured" },
      HttpStatusCodes.SERVICE_UNAVAILABLE
    )
  }

  await removeFromRoom(livekit, sessionId, participantId)
  await markParticipantLeft(sessionId, { participantId })
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const getVoiceCall: AppRouteHandler<GetVoiceCallRoute> = async (c) => {
  const call = await getCurrentCall(c.var.user.id)
  return c.json({ call }, HttpStatusCodes.OK)
}

export const listVoiceSessions: AppRouteHandler<
  ListVoiceSessionsRoute
> = async (c) => {
  const { channelId } = c.req.valid("param")
  const { before, limit } = c.req.valid("query")

  const result = await resolveChannelAccess(c.var.user.id, channelId)
  if (!result.ok) {
    return c.json(
      { success: false as const, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const { type, workspaceId } = result.access.channel
  if (type !== "voice" || !workspaceId) {
    return c.json(
      { success: false as const, message: "Not a voice channel" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const history = await listSessionHistory({
    channelId,
    workspaceId,
    viewerId: c.var.user.id,
    before: before ? new Date(before) : undefined,
    limit,
  })
  return c.json(history, HttpStatusCodes.OK)
}

// "Not found" covers missing and inaccessible, so a restricted channel's
// sessions never leak.
export const getVoiceSession: AppRouteHandler<GetVoiceSessionRoute> = async (
  c
) => {
  const { sessionId } = c.req.valid("param")
  const summary = await getSessionSummary(sessionId, c.var.user.id)
  const access = summary
    ? await resolveChannelAccess(c.var.user.id, summary.channelId)
    : null
  if (!summary || !access?.ok) {
    return c.json(
      { success: false as const, message: "Session not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json(summary, HttpStatusCodes.OK)
}

export const getVoicePresence: AppRouteHandler<GetVoicePresenceRoute> = async (
  c
) => {
  const { user, workspace } = c.var
  const accessible = await listAccessibleChannelIds(user.id, workspace.id)
  const channels = await listWorkspacePresence(workspace.id, accessible)
  return c.json({ channels }, HttpStatusCodes.OK)
}

// Only touches the caller's own participant row, so no channel check is
// needed: a stranger's sessionId matches nothing.
export const leaveVoiceSession: AppRouteHandler<
  LeaveVoiceSessionRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  await markParticipantLeft(sessionId, { userId: c.var.user.id })
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
    {
      url: livekit.url,
      token,
      sessionId: session.id,
      participantId,
      threadRootId: session.threadRootId,
    },
    HttpStatusCodes.OK
  )
}
