import { recordUsage } from "@repo/billing"
import {
  listAccessibleChannelIds,
  resolveChannelAccess,
} from "@repo/db/queries/channel-access"
import { canSeeSession } from "@repo/db/queries/session-chat-access"
import { embedDocumentsWithUsage } from "@repo/lor/embeddings"
import { loadVoiceEntityCards } from "@repo/lor/voice-entities"
import {
  countConnectedParticipants,
  createJoinToken,
  createVoiceRequest,
  dismissVoiceRequest as dismissRequest,
  expireRunApproval,
  findVoiceRequest,
  getCurrentCall,
  getLiveKitConfig,
  listSessionVoiceRequests,
  listTranscript,
  loadSummaryCard,
  markParticipantLeft,
  markVoiceRequestCancelled,
  notifyVoiceRequest,
  removeFromRoom,
  saveEditedSummary,
  stageVoiceRequest as stageRequest,
  summaryPassageFor,
} from "@repo/voice/server"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { assertWorkspaceAuthority } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import {
  getSessionSummary,
  listSessionHistory,
  listWorkspacePresence,
} from "@/lib/voice/queries"
import { enqueueVoiceRequest, stopVoiceRun } from "@/lib/voice/runs"
import {
  findConnectedParticipant,
  findSessionScope,
  getOrCreateLiveSession,
  isSessionFull,
  leaveOtherCalls,
  upsertParticipant,
} from "@/lib/voice/sessions"
import type {
  CancelVoiceRequestRoute,
  ChooseVoiceRequestRoute,
  DismissVoiceRequestRoute,
  GetSummaryCardRoute,
  GetVoiceCallRoute,
  GetVoicePresenceRoute,
  GetVoiceRequestEntitiesRoute,
  GetVoiceSessionRoute,
  GetVoiceTranscriptRoute,
  JoinVoiceChannelRoute,
  LeaveVoiceSessionRoute,
  ListVoiceRequestsRoute,
  ListVoiceSessionsRoute,
  RemoveVoiceParticipantRoute,
  StageVoiceRequestRoute,
  UpdateSummaryCardRoute,
} from "@/routes/v1/voice/routes"

// A session the user may read: channel access, plus the live-only rule.
async function findVisibleSession(userId: string, sessionId: string) {
  const scope = await findSessionScope(sessionId)
  const access = scope
    ? await resolveChannelAccess(userId, scope.channelId)
    : null
  return scope && access?.ok && (await canSeeSession(userId, sessionId))
    ? scope
    : null
}

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

// Same 404 for missing, inaccessible, and live calls the person isn't in.
export const getVoiceTranscript: AppRouteHandler<
  GetVoiceTranscriptRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  const { after, limit } = c.req.valid("query")
  const transcript = (await findVisibleSession(c.var.user.id, sessionId))
    ? await listTranscript(sessionId, { after, limit })
    : null
  if (!transcript) {
    return c.json(
      { success: false as const, message: "Session not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json(transcript, HttpStatusCodes.OK)
}

// Lor's summary card as this person sees it; null when they can't see the
// call (the transcript's rule). Editing needs posting rights in the channel.
// Cards are only posted once a call has ended and been processed, so the
// after-call job never overwrites an edit.
async function readSummaryCard(userId: string, messageId: string) {
  const card = await loadSummaryCard(messageId)
  const access = card
    ? await resolveChannelAccess(userId, card.channelId)
    : null
  if (!card || !access?.ok || !(await canSeeSession(userId, card.sessionId))) {
    return null
  }
  const detail = await getSessionSummary(card.sessionId, userId)
  if (!detail) return null
  return {
    sessionId: card.sessionId,
    call: detail.session,
    summary: card.summary,
    editedAt: card.editedAt?.toISOString() ?? null,
    editedBy: card.editorId
      ? { id: card.editorId, name: card.editorName ?? "Someone" }
      : null,
    canEdit: access.access.canWrite,
  }
}

export const getSummaryCard: AppRouteHandler<GetSummaryCardRoute> = async (
  c
) => {
  const { messageId } = c.req.valid("param")
  const card = await readSummaryCard(c.var.user.id, messageId)
  if (!card) {
    return c.json(
      { success: false as const, message: "Call not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json(card, HttpStatusCodes.OK)
}

export const updateSummaryCard: AppRouteHandler<
  UpdateSummaryCardRoute
> = async (c) => {
  const userId = c.var.user.id
  const { messageId } = c.req.valid("param")
  const summary = c.req.valid("json")
  const current = await readSummaryCard(userId, messageId)
  if (!current) {
    return c.json(
      { success: false as const, message: "Call not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const { sessionId } = current
  if (!current.canEdit) {
    return c.json(
      { success: false as const, message: "You can't post in this channel" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  const passage = await summaryPassageFor(sessionId, summary)
  if (!passage) {
    return c.json(
      { success: false as const, message: "Call not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  // A failed embed keeps the summary findable by keyword, as in the
  // after-call job.
  const embedding = await embedDocumentsWithUsage([
    `${passage.context}\n${passage.text}`,
  ])
    .then((result) => {
      void recordUsage(
        {
          workspaceId: passage.workspaceId,
          tool: "voice.embed",
          model: result.model,
          inputTokens: result.tokens,
        },
        { channelId: passage.channelId }
      )
      return result.embeddings[0] ?? null
    })
    .catch((err: unknown) => {
      logger.warn({ err, sessionId }, "Edited call summary embed failed")
      return null
    })
  await saveEditedSummary(sessionId, {
    summary,
    editedById: userId,
    passage: { ...passage, embedding },
  })
  const updated = await readSummaryCard(userId, messageId)
  return c.json(updated ?? current, HttpStatusCodes.OK)
}

export const listVoiceRequests: AppRouteHandler<
  ListVoiceRequestsRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  if (!(await findVisibleSession(c.var.user.id, sessionId))) {
    return c.json(
      { success: false as const, message: "Session not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json(
    { requests: await listSessionVoiceRequests(sessionId) },
    HttpStatusCodes.OK
  )
}

export const cancelVoiceRequest: AppRouteHandler<
  CancelVoiceRequestRoute
> = async (c) => {
  const { requestId } = c.req.valid("param")
  const found = await findVoiceRequest(requestId)
  const scope = found
    ? await findVisibleSession(c.var.user.id, found.sessionId)
    : null
  if (!scope) {
    return c.json(
      { success: false as const, message: "Request not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const cancelled = await markVoiceRequestCancelled(requestId, c.var.user.id)
  if (!cancelled) {
    return c.json(
      { success: false as const, message: "This request already finished" },
      HttpStatusCodes.CONFLICT
    )
  }
  if (cancelled.runId) {
    await stopVoiceRun(cancelled.runId, c.var.user.id)
    await expireRunApproval(cancelled.runId)
  }
  if (scope.threadRootId) {
    notifyVoiceRequest(scope.threadRootId, cancelled.request)
  }
  return c.json({ request: cancelled.request }, HttpStatusCodes.OK)
}

export const chooseVoiceRequest: AppRouteHandler<
  ChooseVoiceRequestRoute
> = async (c) => {
  const userId = c.var.user.id
  const { requestId } = c.req.valid("param")
  const { choice } = c.req.valid("json")
  const found = await findVoiceRequest(requestId)
  const scope = found ? await findVisibleSession(userId, found.sessionId) : null
  const participant =
    found && scope && !scope.endedAt
      ? await findConnectedParticipant(found.sessionId, userId)
      : null
  if (!found || !scope || !participant) {
    return c.json(
      { success: false as const, message: "Request not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const question = found.result?.blocks.find(
    (block) => block.type === "question"
  )
  const picked =
    question?.type === "question" ? question.choices[choice] : undefined
  if (!picked) {
    return c.json(
      { success: false as const, message: "That choice isn't offered" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const atMs = Date.now() - scope.startedAt.getTime()
  const request = await createVoiceRequest({
    sessionId: found.sessionId,
    participantId: participant.id,
    heardText: picked,
    startMs: atMs,
    endMs: atMs,
    gate: "choice",
    status: "queued",
  })
  if (!request) {
    return c.json(
      { success: false as const, message: "Request not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (scope.threadRootId) notifyVoiceRequest(scope.threadRootId, request)
  await enqueueVoiceRequest(request.id)
  return c.json({ request }, HttpStatusCodes.OK)
}

export const stageVoiceRequest: AppRouteHandler<
  StageVoiceRequestRoute
> = async (c) => {
  const userId = c.var.user.id
  const { requestId } = c.req.valid("param")
  const found = await findVoiceRequest(requestId)
  const scope = found ? await findVisibleSession(userId, found.sessionId) : null
  const participant =
    found && scope && !scope.endedAt
      ? await findConnectedParticipant(found.sessionId, userId)
      : null
  if (!scope || !participant) {
    return c.json(
      { success: false as const, message: "Request not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const request = await stageRequest(requestId)
  if (!request) {
    return c.json(
      { success: false as const, message: "This request has no result" },
      HttpStatusCodes.CONFLICT
    )
  }
  if (scope.threadRootId) notifyVoiceRequest(scope.threadRootId, request)
  return c.json({ request }, HttpStatusCodes.OK)
}

export const getVoiceRequestEntities: AppRouteHandler<
  GetVoiceRequestEntitiesRoute
> = async (c) => {
  const { requestId } = c.req.valid("param")
  const found = await findVoiceRequest(requestId)
  const scope = found
    ? await findVisibleSession(c.var.user.id, found.sessionId)
    : null
  if (!found || !scope) {
    return c.json(
      { success: false as const, message: "Request not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const cards = await loadVoiceEntityCards(
    scope.workspaceId,
    found.result?.blocks ?? []
  )
  return c.json({ cards }, HttpStatusCodes.OK)
}

export const dismissVoiceRequest: AppRouteHandler<
  DismissVoiceRequestRoute
> = async (c) => {
  const { requestId } = c.req.valid("param")
  const found = await findVoiceRequest(requestId)
  const scope = found
    ? await findVisibleSession(c.var.user.id, found.sessionId)
    : null
  if (!scope) {
    return c.json(
      { success: false as const, message: "Request not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const request = await dismissRequest(requestId)
  if (!request) {
    return c.json(
      { success: false as const, message: "This result was already cleared" },
      HttpStatusCodes.CONFLICT
    )
  }
  if (scope.threadRootId) notifyVoiceRequest(scope.threadRootId, request)
  return c.json({ request }, HttpStatusCodes.OK)
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
    livekit,
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
