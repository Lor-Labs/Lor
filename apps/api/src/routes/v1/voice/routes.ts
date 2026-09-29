import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  serviceUnavailableSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  joinVoiceChannelResponseSchema,
  voiceChannelParamsSchema,
} from "@/routes/v1/voice/schema"

export const joinVoiceChannel = createRoute({
  path: "/channels/{channelId}/voice/join",
  method: "post",
  summary: "Join a voice channel",
  description:
    "Issues a short-lived LiveKit token for the voice channel's call. Requires access to the channel.",
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
    [HttpStatusCodes.SERVICE_UNAVAILABLE]: serviceUnavailableSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type JoinVoiceChannelRoute = typeof joinVoiceChannel
