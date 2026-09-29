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
import {
  joinVoiceChannelResponseSchema,
  leaveVoiceSessionResponseSchema,
  voiceChannelParamsSchema,
  voiceSessionParamsSchema,
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
