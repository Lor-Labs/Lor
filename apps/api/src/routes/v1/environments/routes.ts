import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  conflictSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  createEnvironmentRequestSchema,
  deleteEnvironmentResponseSchema,
  environmentIdParamsSchema,
  environmentResponseSchema,
  environmentsParamsSchema,
  listEnvironmentsQuerySchema,
  listEnvironmentsResponseSchema,
  revealEnvironmentResponseSchema,
  updateEnvironmentRequestSchema,
} from "@/routes/v1/environments/schema"

const BASE = "/workspaces/{workspaceSlug}/environments"
const ONE = `${BASE}/{environmentId}`

const common = {
  [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
}

export const listEnvironments = createRoute({
  path: BASE,
  method: "get",
  summary: "List environments",
  description:
    "Environments for code sessions, optionally only those with a repo. Keys only.",
  tags: ["Environments"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: environmentsParamsSchema,
    query: listEnvironmentsQuerySchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listEnvironmentsResponseSchema,
      description: "Environments",
    }),
    ...common,
  },
})

export type ListEnvironmentsRoute = typeof listEnvironments

export const createEnvironment = createRoute({
  path: BASE,
  method: "post",
  summary: "Create an environment",
  description: "Needs environment:manage.",
  tags: ["Environments"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: environmentsParamsSchema,
    body: jsonContent({
      schema: createEnvironmentRequestSchema,
      description: "Name, repo and env files",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: environmentResponseSchema,
      description: "Created",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    ...common,
  },
})

export type CreateEnvironmentRoute = typeof createEnvironment

export const updateEnvironment = createRoute({
  path: ONE,
  method: "put",
  summary: "Update an environment",
  description:
    "Replaces the name and file list. A variable without a value keeps its saved value. Needs environment:manage.",
  tags: ["Environments"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: environmentIdParamsSchema,
    body: jsonContent({
      schema: updateEnvironmentRequestSchema,
      description: "Name and env files",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: environmentResponseSchema,
      description: "Updated",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    ...common,
  },
})

export type UpdateEnvironmentRoute = typeof updateEnvironment

export const revealEnvironment = createRoute({
  path: `${ONE}/reveal`,
  method: "post",
  summary: "Reveal an environment's values",
  description: "Returns decrypted values. Needs environment:manage.",
  tags: ["Environments"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: environmentIdParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: revealEnvironmentResponseSchema,
      description: "Files with keys and values",
    }),
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    ...common,
  },
})

export type RevealEnvironmentRoute = typeof revealEnvironment

export const deleteEnvironment = createRoute({
  path: ONE,
  method: "delete",
  summary: "Delete an environment",
  description:
    "Sessions using it keep their files until the sandbox goes. Needs environment:manage.",
  tags: ["Environments"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: environmentIdParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteEnvironmentResponseSchema,
      description: "Deleted",
    }),
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    ...common,
  },
})

export type DeleteEnvironmentRoute = typeof deleteEnvironment
