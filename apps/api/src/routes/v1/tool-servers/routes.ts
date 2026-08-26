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
  createToolServerRequestSchema,
  deleteToolServerResponseSchema,
  discoverToolServerRequestSchema,
  discoverToolServerResponseSchema,
  listToolServersResponseSchema,
  rediscoverToolServerRequestSchema,
  toolServerIdParamsSchema,
  toolServerResponseSchema,
  toolServersWorkspaceParamsSchema,
  updateToolServerRequestSchema,
} from "@/routes/v1/tool-servers/schema"

export const listToolServers = createRoute({
  path: "/workspaces/{workspaceSlug}/tool-servers",
  method: "get",
  summary: "List a workspace's MCP tool servers",
  description:
    "Returns the workspace's configured tool servers, including inactive OAuth states. Secret and OAuth credential values are never returned.",
  tags: ["Tool Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: toolServersWorkspaceParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listToolServersResponseSchema,
      description: "Tool servers",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const createToolServer = createRoute({
  path: "/workspaces/{workspaceSlug}/tool-servers",
  method: "post",
  summary: "Connect an MCP tool server",
  description:
    "Registers a remote Streamable HTTP MCP server with shared OAuth or header/API-key authentication. `enabledTools` is the allowlist of server tools Merlin may bind.",
  tags: ["Tool Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: toolServersWorkspaceParamsSchema,
    body: jsonContent({
      schema: createToolServerRequestSchema,
      description: "The server descriptor",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: toolServerResponseSchema,
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

export const updateToolServer = createRoute({
  path: "/workspaces/{workspaceSlug}/tool-servers/{serverId}",
  method: "patch",
  summary: "Update an MCP tool server",
  description:
    "Edits the descriptor in place. Secrets merge: a string sets a value, null deletes it.",
  tags: ["Tool Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: toolServerIdParamsSchema,
    body: jsonContent({
      schema: updateToolServerRequestSchema,
      description: "Fields to update",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: toolServerResponseSchema,
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

export const deleteToolServer = createRoute({
  path: "/workspaces/{workspaceSlug}/tool-servers/{serverId}",
  method: "delete",
  summary: "Delete an MCP tool server",
  description: "Permanently deletes the server; profile grants cascade away.",
  tags: ["Tool Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: toolServerIdParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteToolServerResponseSchema,
      description: "Deleted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const discoverToolServer = createRoute({
  path: "/workspaces/{workspaceSlug}/tool-servers/discover",
  method: "post",
  summary: "Discover an MCP server's tools (pre-save)",
  description:
    "Connects with the given url/headers/secrets and returns the server's tool list. Nothing is persisted.",
  tags: ["Tool Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: toolServersWorkspaceParamsSchema,
    body: jsonContent({
      schema: discoverToolServerRequestSchema,
      description: "Connection settings to test",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discoverToolServerResponseSchema,
      description: "The server's tools",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const rediscoverToolServer = createRoute({
  path: "/workspaces/{workspaceSlug}/tool-servers/{serverId}/discover",
  method: "post",
  summary: "Re-discover a saved MCP server's tools",
  description:
    "Connects using the stored config (optionally overlaid with unsaved edits) and returns the current tool list.",
  tags: ["Tool Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: toolServerIdParamsSchema,
    body: jsonContent({
      schema: rediscoverToolServerRequestSchema,
      description: "Optional unsaved overrides",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discoverToolServerResponseSchema,
      description: "The server's tools",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListToolServersRoute = typeof listToolServers
export type CreateToolServerRoute = typeof createToolServer
export type UpdateToolServerRoute = typeof updateToolServer
export type DeleteToolServerRoute = typeof deleteToolServer
export type DiscoverToolServerRoute = typeof discoverToolServer
export type RediscoverToolServerRoute = typeof rediscoverToolServer
