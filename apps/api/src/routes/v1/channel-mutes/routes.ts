import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  forbiddenSchema,
  internalServerErrorSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  channelMuteParamsSchema,
  listChannelMutesResponseSchema,
  muteChannelBodySchema,
  muteChannelResponseSchema,
  unmuteChannelResponseSchema,
} from "@/routes/v1/channel-mutes/schema"

export const listChannelMutes = createRoute({
  path: "/channel-mutes",
  method: "get",
  summary: "List channel mutes",
  description:
    "Lists the current user's active channel mutes (expired mutes are pruned).",
  tags: ["Channel Mutes"],
  middleware: [sessionAuthMiddleware] as const,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChannelMutesResponseSchema,
      description: "Active channel mutes",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListChannelMutesRoute = typeof listChannelMutes

export const muteChannel = createRoute({
  path: "/channel-mutes/{channelId}",
  method: "put",
  summary: "Mute a channel",
  description:
    "Mutes a channel (or DM) for the current user until the given time, or indefinitely when until is null. Badges are unaffected; only notifications are suppressed.",
  tags: ["Channel Mutes"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: channelMuteParamsSchema,
    body: jsonContent({
      schema: muteChannelBodySchema,
      description: "Mute expiry",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: muteChannelResponseSchema,
      description: "Channel muted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type MuteChannelRoute = typeof muteChannel

export const unmuteChannel = createRoute({
  path: "/channel-mutes/{channelId}",
  method: "delete",
  summary: "Unmute a channel",
  description: "Removes the current user's mute on a channel.",
  tags: ["Channel Mutes"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: channelMuteParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: unmuteChannelResponseSchema,
      description: "Channel unmuted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UnmuteChannelRoute = typeof unmuteChannel
