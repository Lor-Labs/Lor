import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  channelPlansParamsSchema,
  channelPlansQuerySchema,
  getPlanResponseSchema,
  listChannelPlansResponseSchema,
  planParamsSchema,
} from "@/routes/v1/plans/schema"

export const listChannelPlans = createRoute({
  path: "/channels/{channelId}/plans",
  method: "get",
  summary: "List a channel's plans",
  description:
    "Returns the channel's plans, newest first. Pass active=true for running or waiting plans, or messageId to resolve a specific card or thread regardless of age.",
  tags: ["Plans"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: channelPlansParamsSchema,
    query: channelPlansQuerySchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChannelPlansResponseSchema,
      description: "Channel plans",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListChannelPlansRoute = typeof listChannelPlans

export const getPlan = createRoute({
  path: "/plans/{planId}",
  method: "get",
  summary: "Get a plan",
  description:
    "Returns the plan snapshot plus its pending approval, if one is waiting on the team.",
  tags: ["Plans"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: planParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: getPlanResponseSchema,
      description: "Plan and pending approval",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetPlanRoute = typeof getPlan
