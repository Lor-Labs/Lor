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
  artifactParamsSchema,
  getArtifactResponseSchema,
  listTaskArtifactsResponseSchema,
  taskArtifactsParamsSchema,
} from "@/routes/v1/artifacts/schema"

export const getArtifact = createRoute({
  path: "/artifacts/{artifactId}",
  method: "get",
  summary: "Get an artifact with its version history",
  description:
    "Returns an artifact's identity row and its full version history (newest first), each version carrying the public URL of its blob.",
  tags: ["Artifacts"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: artifactParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: getArtifactResponseSchema,
      description: "Artifact and versions",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetArtifactRoute = typeof getArtifact

export const listTaskArtifacts = createRoute({
  path: "/tasks/{taskId}/artifacts",
  method: "get",
  summary: "List a task's artifacts",
  description:
    "Returns the artifacts belonging to a quest task, each at its current version with a public blob URL.",
  tags: ["Artifacts"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: taskArtifactsParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listTaskArtifactsResponseSchema,
      description: "Task artifacts",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListTaskArtifactsRoute = typeof listTaskArtifacts
