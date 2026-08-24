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
  deleteLoopResponseSchema,
  listChannelLoopsResponseSchema,
  listLoopRunsResponseSchema,
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
  summary: "Edit a loop",
  description:
    "Updates the schedule, instructions, or name. Schedule edits re-validate; on active loops the next run is recomputed, and a sub-hourly cadence that got tighter needs confirmHighFrequency again. Completed loops are immutable.",
  tags: ["Loops"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: loopParamsSchema,
    body: jsonContent({
      schema: updateLoopBodySchema,
      description: "Fields to update",
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
    [HttpStatusCodes.UNPROCESSABLE_ENTITY]: jsonContent({
      schema: requiresConfirmationResponseSchema,
      description: "Tightened sub-hourly schedule needs explicit confirmation",
    }),
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UpdateLoopRoute = typeof updateLoop

// Lifecycle actions. Wrong-state calls (pause a draft, resume an active
// loop, double clicks) all read as 409 — the CAS in the lib helpers decides.

export const pauseLoop = createRoute({
  path: "/loops/{loopId}/pause",
  method: "post",
  summary: "Pause an active loop",
  description:
    "Stops future runs and flags any in-flight run to stop — same mechanics as a user stop.",
  tags: ["Loops"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: loopParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: activateLoopResponseSchema,
      description: "The paused loop",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type PauseLoopRoute = typeof pauseLoop

export const resumeLoop = createRoute({
  path: "/loops/{loopId}/resume",
  method: "post",
  summary: "Resume a paused loop",
  description:
    "Re-validates the schedule, recomputes the next run time, and resets the failure counter.",
  tags: ["Loops"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: loopParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: activateLoopResponseSchema,
      description: "The resumed loop",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ResumeLoopRoute = typeof resumeLoop

export const completeLoop = createRoute({
  path: "/loops/{loopId}/complete",
  method: "post",
  summary: "Mark a loop completed",
  description:
    "Permanently completes an active or paused loop — it never runs again. In-flight runs are flagged to stop.",
  tags: ["Loops"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: loopParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: activateLoopResponseSchema,
      description: "The completed loop",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type CompleteLoopRoute = typeof completeLoop

export const listLoopRuns = createRoute({
  path: "/loops/{loopId}/runs",
  method: "get",
  summary: "List a loop's run history",
  description:
    "Returns the loop's scheduled runs (newest first): outcome, closing note, recorded actions, and spawned tasks/artifacts.",
  tags: ["Loops"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: loopParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listLoopRunsResponseSchema,
      description: "Loop run history",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListLoopRunsRoute = typeof listLoopRuns

export const deleteLoop = createRoute({
  path: "/loops/{loopId}",
  method: "delete",
  summary: "Delete a loop",
  description:
    "Hard-deletes the loop and its card message; in-flight runs are flagged to stop. Run history rows survive for audit.",
  tags: ["Loops"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: loopParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteLoopResponseSchema,
      description: "Loop deleted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type DeleteLoopRoute = typeof deleteLoop
