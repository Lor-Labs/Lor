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
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  environmentParamsSchema,
  environmentResponseSchema,
  revealEnvironmentResponseSchema,
  saveEnvironmentRequestSchema,
} from "@/routes/v1/environments/schema"

const PATH = "/workspaces/{workspaceSlug}/environments/{owner}/{repo}"

export const getEnvironment = createRoute({
  path: PATH,
  method: "get",
  summary: "Get a repo's environment",
  description:
    "The env file Lor writes into code sessions on this repo. Keys only; values come from reveal.",
  tags: ["Environments"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: environmentParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: environmentResponseSchema,
      description: "The environment",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetEnvironmentRoute = typeof getEnvironment

export const saveEnvironment = createRoute({
  path: PATH,
  method: "put",
  summary: "Save a repo's environment",
  description:
    "Replaces the variable list. A variable without a value keeps its saved value. Needs environment:manage.",
  tags: ["Environments"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: environmentParamsSchema,
    body: jsonContent({
      schema: saveEnvironmentRequestSchema,
      description: "File name and variables",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: environmentResponseSchema,
      description: "The saved environment",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type SaveEnvironmentRoute = typeof saveEnvironment

export const revealEnvironment = createRoute({
  path: `${PATH}/reveal`,
  method: "post",
  summary: "Reveal a repo's environment values",
  description: "Returns the decrypted values. Needs environment:manage.",
  tags: ["Environments"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: environmentParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: revealEnvironmentResponseSchema,
      description: "Keys and values",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type RevealEnvironmentRoute = typeof revealEnvironment
