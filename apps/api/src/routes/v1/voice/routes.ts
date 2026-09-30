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
  joinVoiceChannelResponseSchema,
  leaveVoiceSessionResponseSchema,
  removeVoiceParticipantParamsSchema,
  removeVoiceParticipantResponseSchema,
  voiceCallResponseSchema,
  voiceChannelParamsSchema,
  voicePresenceResponseSchema,
  voiceSessionDetailResponseSchema,
  voiceSessionHistoryQuerySchema,
  voiceSessionHistoryResponseSchema,
  voiceSessionParamsSchema,
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
