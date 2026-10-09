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
  getAgentSessionResponseSchema,
  sessionParamsSchema,
  updateAgentSessionRequestSchema,
  updateAgentSessionResponseSchema,
} from "@/routes/v1/sessions/schema"

export const getAgentSession = createRoute({
  path: "/sessions/{sessionId}",
  method: "get",
  summary: "Get a Lor session",
  description:
    "Returns a Lor session, its channel, and the messages it started with.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: getAgentSessionResponseSchema,
      description: "Session, channel and starting context",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetAgentSessionRoute = typeof getAgentSession

export const updateAgentSession = createRoute({
  path: "/sessions/{sessionId}",
  method: "patch",
  summary: "Rename, archive or unarchive a Lor session",
  description:
    "Anyone who can write in the channel can do this. A rename stops generated titles. Archiving closes the session for everyone and stops Lor if it is running.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
    body: jsonContent({
      schema: updateAgentSessionRequestSchema,
      description: "Fields to update",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateAgentSessionResponseSchema,
      description: "The updated session",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UpdateAgentSessionRoute = typeof updateAgentSession
