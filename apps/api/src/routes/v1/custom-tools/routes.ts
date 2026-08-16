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
  archiveCustomToolResponseSchema,
  createCustomToolRequestSchema,
  customToolIdParamsSchema,
  customToolResponseSchema,
  customToolsWorkspaceParamsSchema,
  listCustomToolsResponseSchema,
  updateCustomToolRequestSchema,
} from "@/routes/v1/custom-tools/schema"

export const listCustomTools = createRoute({
  path: "/workspaces/{workspaceSlug}/custom-tools",
  method: "get",
  summary: "List a workspace's custom tools",
  description:
    "Returns active and archived custom tools. Secret values are never returned — names only.",
  tags: ["Custom Tools"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: customToolsWorkspaceParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listCustomToolsResponseSchema,
      description: "Custom tools",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const createCustomTool = createRoute({
  path: "/workspaces/{workspaceSlug}/custom-tools",
  method: "post",
  summary: "Create a custom tool",
  description:
    "Registers an HTTP tool Merlin can call in channels that grant the custom_tools capability.",
  tags: ["Custom Tools"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: customToolsWorkspaceParamsSchema,
    body: jsonContent({
      schema: createCustomToolRequestSchema,
      description: "The tool descriptor",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: customToolResponseSchema,
      description: "Created",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const updateCustomTool = createRoute({
  path: "/workspaces/{workspaceSlug}/custom-tools/{toolId}",
  method: "patch",
  summary: "Update a custom tool",
  description:
    "Edits the descriptor in place. Secrets merge: a string sets a value, null deletes it.",
  tags: ["Custom Tools"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: customToolIdParamsSchema,
    body: jsonContent({
      schema: updateCustomToolRequestSchema,
      description: "Fields to update",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: customToolResponseSchema,
      description: "Updated",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const archiveCustomTool = createRoute({
  path: "/workspaces/{workspaceSlug}/custom-tools/{toolId}",
  method: "delete",
  summary: "Archive a custom tool",
  description:
    "Archive-not-delete: the row is kept, stops binding, and frees its name.",
  tags: ["Custom Tools"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: customToolIdParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: archiveCustomToolResponseSchema,
      description: "Archived",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListCustomToolsRoute = typeof listCustomTools
export type CreateCustomToolRoute = typeof createCustomTool
export type UpdateCustomToolRoute = typeof updateCustomTool
export type ArchiveCustomToolRoute = typeof archiveCustomTool
