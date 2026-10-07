import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  conflictSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  serviceUnavailableSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  callSummaryBodySchema,
  cancelVoiceRequestResponseSchema,
  chooseVoiceRequestBodySchema,
  deleteVoiceSessionParamsSchema,
  joinVoiceChannelResponseSchema,
  leaveVoiceSessionResponseSchema,
  removeVoiceParticipantParamsSchema,
  removeVoiceParticipantResponseSchema,
  summaryCardParamsSchema,
  summaryCardResponseSchema,
  voiceCallResponseSchema,
  voiceChannelParamsSchema,
  voiceEntitiesResponseSchema,
  voicePresenceResponseSchema,
  voiceRequestParamsSchema,
  voiceRequestsResponseSchema,
  voiceSessionDetailResponseSchema,
  voiceSessionHistoryQuerySchema,
  voiceSessionHistoryResponseSchema,
  voiceSessionParamsSchema,
  voiceTranscriptQuerySchema,
  voiceTranscriptResponseSchema,
  workspaceSlugParamsSchema,
} from "@/routes/v1/voice/schema"

export const joinVoiceChannel = createRoute({
  path: "/channels/{channelId}/voice/join",
  method: "post",
  summary: "Join a voice channel",
  description:
    "Joins the voice channel's live session, starting one if none is live, and issues a short-lived LiveKit token. Leaves any other call the user is in. Requires access to the channel.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceChannelParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: joinVoiceChannelResponseSchema,
      description: "LiveKit server URL and join token",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.SERVICE_UNAVAILABLE]: serviceUnavailableSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type JoinVoiceChannelRoute = typeof joinVoiceChannel

export const leaveVoiceSession = createRoute({
  path: "/voice/sessions/{sessionId}/leave",
  method: "post",
  summary: "Leave a voice session",
  description:
    "Marks the current user as disconnected from the session. A client hint; the LiveKit webhook is the authority.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceSessionParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: leaveVoiceSessionResponseSchema,
      description: "Left the session",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type LeaveVoiceSessionRoute = typeof leaveVoiceSession

export const getVoiceCall = createRoute({
  path: "/voice/call",
  method: "get",
  summary: "Current voice call",
  description:
    "The live call the current user is connected to on any device, so other devices can offer to take it over.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: voiceCallResponseSchema,
      description: "Current call, or null",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetVoiceCallRoute = typeof getVoiceCall

export const removeVoiceParticipant = createRoute({
  path: "/workspaces/{workspaceSlug}/voice/sessions/{sessionId}/participants/{participantId}",
  method: "delete",
  summary: "Remove someone from a call",
  description:
    "Disconnects a participant from a live session. Requires the voice moderation permission and access to the channel.",
  tags: ["Voice"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: removeVoiceParticipantParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: removeVoiceParticipantResponseSchema,
      description: "Participant removed",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.SERVICE_UNAVAILABLE]: serviceUnavailableSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type RemoveVoiceParticipantRoute = typeof removeVoiceParticipant

export const deleteVoiceSession = createRoute({
  path: "/workspaces/{workspaceSlug}/voice/sessions/{sessionId}",
  method: "delete",
  summary: "Delete a call",
  description:
    "Deletes an ended call with its chat, transcript, summary, search passages, and Lor's runs in it. Requires the voice delete permission and access to the channel.",
  tags: ["Voice"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: deleteVoiceSessionParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: removeVoiceParticipantResponseSchema,
      description: "Call deleted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type DeleteVoiceSessionRoute = typeof deleteVoiceSession

export const listVoiceSessions = createRoute({
  path: "/channels/{channelId}/voice/sessions",
  method: "get",
  summary: "List a voice channel's sessions",
  description:
    "Session history, newest first, including the live session. One-person sessions with nothing posted are hidden.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceChannelParamsSchema,
    query: voiceSessionHistoryQuerySchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: voiceSessionHistoryResponseSchema,
      description: "Session history page",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListVoiceSessionsRoute = typeof listVoiceSessions

export const getVoiceSession = createRoute({
  path: "/voice/sessions/{sessionId}",
  method: "get",
  summary: "Get a voice session",
  description: "One session with its participants. Requires channel access.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceSessionParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: voiceSessionDetailResponseSchema,
      description: "Voice session",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetVoiceSessionRoute = typeof getVoiceSession

export const getVoiceTranscript = createRoute({
  path: "/voice/sessions/{sessionId}/transcript",
  method: "get",
  summary: "Get a voice session transcript",
  description:
    "Final transcript segments in timeline order, with capture gaps. A live session's transcript is only for people connected to the call; after it ends, channel access applies.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceSessionParamsSchema,
    query: voiceTranscriptQuerySchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: voiceTranscriptResponseSchema,
      description: "Transcript page",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetVoiceTranscriptRoute = typeof getVoiceTranscript

export const getSummaryCard = createRoute({
  path: "/voice/summary-cards/{messageId}",
  method: "get",
  summary: "Get a call summary card",
  description:
    "What Lor's summary card in a call chat shows: the call (date, length, participants) and its current summary (title, decisions, open questions, action items), with who last corrected it. Same access as the call's transcript.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: summaryCardParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: summaryCardResponseSchema,
      description: "Call summary card",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetSummaryCardRoute = typeof getSummaryCard

export const updateSummaryCard = createRoute({
  path: "/voice/summary-cards/{messageId}",
  method: "put",
  summary: "Correct a call's summary",
  description:
    "Replaces the summary on Lor's card and re-indexes it for Lor's search, recording who edited it. Anyone who can post in the channel can edit.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: summaryCardParamsSchema,
    body: jsonContent({
      schema: callSummaryBodySchema,
      description: "The corrected summary",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: summaryCardResponseSchema,
      description: "Call summary card",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UpdateSummaryCardRoute = typeof updateSummaryCard

export const listVoiceRequests = createRoute({
  path: "/voice/sessions/{sessionId}/requests",
  method: "get",
  summary: "List a voice session's requests to Lor",
  description:
    "Requests to Lor in this session, oldest first, for Lor's window and the Lor tab. A live session's requests are only for people connected to the call; after it ends, channel access applies.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceSessionParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: voiceRequestsResponseSchema,
      description: "Requests",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListVoiceRequestsRoute = typeof listVoiceRequests

export const cancelVoiceRequest = createRoute({
  path: "/voice/requests/{requestId}/cancel",
  method: "post",
  summary: "Cancel a request to Lor",
  description:
    "Cancels a request Lor is listening to or working on. Anyone in the call can cancel.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceRequestParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: cancelVoiceRequestResponseSchema,
      description: "The cancelled request",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type CancelVoiceRequestRoute = typeof cancelVoiceRequest

export const dismissVoiceRequest = createRoute({
  path: "/voice/requests/{requestId}/dismiss",
  method: "post",
  summary: "Clear a result from Lor's window",
  description:
    "Clears a finished request's result from Lor's window for everyone in the call. Anyone in the call can clear it.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceRequestParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: cancelVoiceRequestResponseSchema,
      description: "The cleared request",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type DismissVoiceRequestRoute = typeof dismissVoiceRequest

export const chooseVoiceRequest = createRoute({
  path: "/voice/requests/{requestId}/choose",
  method: "post",
  summary: "Pick a choice Lor offered",
  description:
    "Answers the question in a request's result by picking one of its choices. The pick becomes a new request to Lor from the person who clicked; it must come from someone in the live call.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceRequestParamsSchema,
    body: jsonContent({
      schema: chooseVoiceRequestBodySchema,
      description: "The picked choice",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: cancelVoiceRequestResponseSchema,
      description: "The new request",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ChooseVoiceRequestRoute = typeof chooseVoiceRequest

export const stageVoiceRequest = createRoute({
  path: "/voice/requests/{requestId}/stage",
  method: "post",
  summary: "Show an earlier result in Lor's window",
  description:
    "Brings a finished result back into Lor's window for everyone in the live call. It must come from someone in the call.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceRequestParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: cancelVoiceRequestResponseSchema,
      description: "The request now on stage",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type StageVoiceRequestRoute = typeof stageVoiceRequest

export const getVoiceRequestEntities = createRoute({
  path: "/voice/requests/{requestId}/entities",
  method: "get",
  summary: "Live cards for a result in Lor's window",
  description:
    "Current data for the Linear issues and GitHub pull requests a request's result names, read with the workspace's connections. Anyone who can see the call can read it.",
  tags: ["Voice"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: voiceRequestParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: voiceEntitiesResponseSchema,
      description: "The cards",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetVoiceRequestEntitiesRoute = typeof getVoiceRequestEntities

export const getVoicePresence = createRoute({
  path: "/workspaces/{workspaceSlug}/voice/presence",
  method: "get",
  summary: "Voice presence",
  description:
    "People connected to each live voice session the user can access, for the sidebar.",
  tags: ["Voice"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceSlugParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: voicePresenceResponseSchema,
      description: "Connected participants per voice channel",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetVoicePresenceRoute = typeof getVoicePresence
