import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  conflictSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  activateLoopBodySchema,
  activateLoopResponseSchema,
  channelLoopsParamsSchema,
  listChannelLoopsResponseSchema,
  loopParamsSchema,
  requiresConfirmationResponseSchema,
  updateLoopBodySchema,
} from "@/routes/v1/loops/schema"

// Access denials read as not_found (fail closed): a loop's existence reveals
// channel activity, so invisible channels 404 rather than 403.

export const listChannelLoops = createRoute({
  path: "/channels/{channelId}/loops",
  method: "get",
  summary: "List a channel's loops",
  description:
    "Returns the channel's loops, newest first. Cards look their loop up by cardMessageId.",
  tags: ["Loops"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: channelLoopsParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChannelLoopsResponseSchema,
      description: "Channel loops",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListChannelLoopsRoute = typeof listChannelLoops

export const activateLoop = createRoute({
  path: "/loops/{loopId}/activate",
  method: "post",
  summary: "Activate a draft loop",
  description:
    "Pins the timezone, re-validates the schedule, computes the first run time, and flips the draft active. Sub-hourly schedules return requires_confirmation until the body carries confirmHighFrequency.",
  tags: ["Loops"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: loopParamsSchema,
    body: jsonContent({
      schema: activateLoopBodySchema,
      description: "Timezone to pin + optional high-frequency consent",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: activateLoopResponseSchema,
      description: "The activated loop",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.UNPROCESSABLE_ENTITY]: jsonContent({
      schema: requiresConfirmationResponseSchema,
      description: "Sub-hourly schedule needs explicit confirmation",
    }),
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ActivateLoopRoute = typeof activateLoop

export const updateLoop = createRoute({
  path: "/loops/{loopId}",
  method: "patch",
  summary: "Edit a draft loop's schedule",
  description:
    "Replaces the draft's cron schedule after validating it. Editing active loops is not supported yet — pause-edit-resume lands with the management UI.",
  tags: ["Loops"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: loopParamsSchema,
    body: jsonContent({
      schema: updateLoopBodySchema,
      description: "The new cron schedule",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: activateLoopResponseSchema,
      description: "The updated loop",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UpdateLoopRoute = typeof updateLoop
