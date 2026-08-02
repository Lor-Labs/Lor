import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  conflictSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  runEventsParamsSchema,
  runEventsQuerySchema,
  runEventsResponseSchema,
  stopRunResponseSchema,
} from "@/routes/v1/runs/schema"

export const getRunEvents = createRoute({
  path: "/runs/by-message/{messageId}/events",
  method: "get",
  summary: "Replay an agent run's event log",
  description:
    "Returns the durable run state and ordered events for the agent run streaming into the given message, so a late-joining or reconnecting client can rebuild the full trace before draining buffered live frames. Pass `after` (the highest seq already applied) to fetch only newer events.",
  tags: ["Runs"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: runEventsParamsSchema,
    query: runEventsQuerySchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: runEventsResponseSchema,
      description: "Run state and ordered events",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetRunEventsRoute = typeof getRunEvents

export const stopRun = createRoute({
  path: "/runs/by-message/{messageId}/stop",
  method: "post",
  summary: "Stop an in-flight agent run",
  description:
    "Requests a user stop of the agent run streaming into the given message. A never-claimed run settles immediately; a working run is stopped by its lease holder at the next safe step boundary, keeping whatever answer already streamed. Restarting is a separate explicit action (a new mention).",
  tags: ["Runs"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: runEventsParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: stopRunResponseSchema,
      description: "Stop recorded",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type StopRunRoute = typeof stopRun
