import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  artifactParamsSchema,
  channelFilesParamsSchema,
  channelFilesQuerySchema,
  channelFilesResponseSchema,
  getArtifactResponseSchema,
  listPlanArtifactsResponseSchema,
  planArtifactsParamsSchema,
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
  hide: true,
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

export const listPlanArtifacts = createRoute({
  path: "/plans/{planId}/artifacts",
  method: "get",
  summary: "List a plan's artifacts",
  description:
    "Returns the artifacts belonging to a plan, each at its current version with a public blob URL.",
  tags: ["Artifacts"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: planArtifactsParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listPlanArtifactsResponseSchema,
      description: "Plan artifacts",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListPlanArtifactsRoute = typeof listPlanArtifacts

export const listChannelFiles = createRoute({
  path: "/channels/{channelId}/files",
  method: "get",
  summary: "List channel files",
  tags: ["Artifacts"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: channelFilesParamsSchema, query: channelFilesQuerySchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: channelFilesResponseSchema,
      description: "Latest artifacts and uploaded files, newest first",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListChannelFilesRoute = typeof listChannelFiles
