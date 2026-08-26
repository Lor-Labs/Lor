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
  createMcpServerRequestSchema,
  deleteMcpServerResponseSchema,
  discoverMcpServerRequestSchema,
  discoverMcpServerResponseSchema,
  listMcpServersResponseSchema,
  mcpServerIdParamsSchema,
  mcpServerResponseSchema,
  mcpServersWorkspaceParamsSchema,
  rediscoverMcpServerRequestSchema,
  updateMcpServerRequestSchema,
} from "@/routes/v1/mcp-servers/schema"

export const listMcpServers = createRoute({
  path: "/workspaces/{workspaceSlug}/mcp-servers",
  method: "get",
  summary: "List a workspace's MCP servers",
  description:
    "Returns the workspace's configured MCP servers, including inactive OAuth states. Secret and OAuth credential values are never returned.",
  tags: ["MCP Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: mcpServersWorkspaceParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listMcpServersResponseSchema,
      description: "MCP servers",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const createMcpServer = createRoute({
  path: "/workspaces/{workspaceSlug}/mcp-servers",
  method: "post",
  summary: "Connect an MCP server",
  description:
    "Registers a remote Streamable HTTP MCP server with shared OAuth or header/API-key authentication. `enabledTools` is the allowlist of server tools Merlin may bind.",
  tags: ["MCP Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: mcpServersWorkspaceParamsSchema,
    body: jsonContent({
      schema: createMcpServerRequestSchema,
      description: "The server descriptor",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: mcpServerResponseSchema,
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

export const updateMcpServer = createRoute({
  path: "/workspaces/{workspaceSlug}/mcp-servers/{mcpServerId}",
  method: "patch",
  summary: "Update an MCP server",
  description:
    "Edits the descriptor in place. Secrets merge: a string sets a value, null deletes it.",
  tags: ["MCP Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: mcpServerIdParamsSchema,
    body: jsonContent({
      schema: updateMcpServerRequestSchema,
      description: "Fields to update",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: mcpServerResponseSchema,
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

export const deleteMcpServer = createRoute({
  path: "/workspaces/{workspaceSlug}/mcp-servers/{mcpServerId}",
  method: "delete",
  summary: "Delete an MCP server",
  description: "Permanently deletes the server; profile grants cascade away.",
  tags: ["MCP Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: mcpServerIdParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteMcpServerResponseSchema,
      description: "Deleted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const discoverMcpServer = createRoute({
  path: "/workspaces/{workspaceSlug}/mcp-servers/discover",
  method: "post",
  summary: "Discover an MCP server's tools (pre-save)",
  description:
    "Connects with the given url/headers/secrets and returns the server's tool list. Nothing is persisted.",
  tags: ["MCP Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: mcpServersWorkspaceParamsSchema,
    body: jsonContent({
      schema: discoverMcpServerRequestSchema,
      description: "Connection settings to test",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discoverMcpServerResponseSchema,
      description: "The server's tools",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const rediscoverMcpServer = createRoute({
  path: "/workspaces/{workspaceSlug}/mcp-servers/{mcpServerId}/discover",
  method: "post",
  summary: "Re-discover a saved MCP server's tools",
  description:
    "Connects using the stored config (optionally overlaid with unsaved edits) and returns the current tool list.",
  tags: ["MCP Servers"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: mcpServerIdParamsSchema,
    body: jsonContent({
      schema: rediscoverMcpServerRequestSchema,
      description: "Optional unsaved overrides",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discoverMcpServerResponseSchema,
      description: "The server's tools",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListMcpServersRoute = typeof listMcpServers
export type CreateMcpServerRoute = typeof createMcpServer
export type UpdateMcpServerRoute = typeof updateMcpServer
export type DeleteMcpServerRoute = typeof deleteMcpServer
export type DiscoverMcpServerRoute = typeof discoverMcpServer
export type RediscoverMcpServerRoute = typeof rediscoverMcpServer
