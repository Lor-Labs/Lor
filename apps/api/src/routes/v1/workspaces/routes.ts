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
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  completeWorkspaceSetupResponseSchema,
  createWorkspaceRequestSchema,
  createWorkspaceResponseSchema,
  deleteWorkspaceRoleResponseSchema,
  listWorkspaceMembersResponseSchema,
  moderateWorkspaceMemberResponseSchema,
  searchMessagesQuerySchema,
  searchMessagesResponseSchema,
  updateWorkspaceMemberRoleRequestSchema,
  updateWorkspaceMemberRoleResponseSchema,
  updateWorkspaceRequestSchema,
  updateWorkspaceResponseSchema,
  workspaceMemberParamsSchema,
  workspaceRoleParamsSchema,
  workspaceSlugParamsSchema,
} from "@/routes/v1/workspaces/schema"

export const createWorkspace = createRoute({
  path: "/workspaces",
  method: "post",
  summary: "Create a workspace",
  description:
    "Creates a workspace owned by the caller, with a server-generated URL key, and seeds its default channels.",
  tags: ["Workspaces"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    body: jsonContent({
      schema: createWorkspaceRequestSchema,
      description: "Workspace details",
    }),
  },
  responses: {
    [HttpStatusCodes.CREATED]: jsonContent({
      schema: createWorkspaceResponseSchema,
      description: "Created workspace and its first channel",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type CreateWorkspaceRoute = typeof createWorkspace

export const completeWorkspaceSetup = createRoute({
  path: "/workspaces/{workspaceSlug}/setup/complete",
  method: "post",
  summary: "Mark workspace setup as finished",
  description:
    "Ends the first-run setup checklist for everyone in the workspace. Requires the connector:manage authority.",
  tags: ["Workspaces"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceSlugParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: completeWorkspaceSetupResponseSchema,
      description: "Setup completion time",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type CompleteWorkspaceSetupRoute = typeof completeWorkspaceSetup

export const listWorkspaceMembers = createRoute({
  path: "/workspaces/{workspaceSlug}/members",
  method: "get",
  summary: "List workspace members with presence",
  description:
    "Returns all workspace members and their current online/offline status.",
  tags: ["Workspaces"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceSlugParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listWorkspaceMembersResponseSchema,
      description: "Workspace members with presence status",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListWorkspaceMembersRoute = typeof listWorkspaceMembers

export const updateWorkspaceMemberRole = createRoute({
  path: "/workspaces/{workspaceSlug}/members/{userId}/role",
  method: "patch",
  summary: "Update a workspace member role",
  description:
    "Updates a workspace member's role (static or custom). Requires member role update permission and sufficient hierarchy.",
  tags: ["Workspaces"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceMemberParamsSchema,
    body: jsonContent({
      schema: updateWorkspaceMemberRoleRequestSchema,
      description: "Updated workspace role (static or custom role name)",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateWorkspaceMemberRoleResponseSchema,
      description: "Updated workspace member",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UpdateWorkspaceMemberRoleRoute = typeof updateWorkspaceMemberRole

export const deleteWorkspaceRole = createRoute({
  path: "/workspaces/{workspaceSlug}/roles/{roleName}",
  method: "delete",
  summary: "Delete a custom workspace role",
  description:
    "Deletes a custom role and reassigns its members to the member role. Static roles cannot be deleted. Role create/update/list go through better-auth's organization endpoints; delete is first-party so the reassignment is transactional.",
  tags: ["Workspaces"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceRoleParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteWorkspaceRoleResponseSchema,
      description: "Role deleted, members reassigned",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type DeleteWorkspaceRoleRoute = typeof deleteWorkspaceRole

export const kickWorkspaceMember = createRoute({
  path: "/workspaces/{workspaceSlug}/members/{userId}/kick",
  method: "post",
  summary: "Kick a workspace member",
  description:
    "Removes a member from the workspace. Requires the workspaceMember:kick authority; the owner cannot be kicked, and the actor must outrank the target.",
  tags: ["Workspaces"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceMemberParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: moderateWorkspaceMemberResponseSchema,
      description: "Member kicked",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type KickWorkspaceMemberRoute = typeof kickWorkspaceMember

export const searchMessages = createRoute({
  path: "/workspaces/{workspaceSlug}/search",
  method: "get",
  summary: "Search messages in a workspace",
  description:
    "Searches messages across all channels in a workspace. Optionally filter by channel.",
  tags: ["Workspaces"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceSlugParamsSchema,
    query: searchMessagesQuerySchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: searchMessagesResponseSchema,
      description: "Search results",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type SearchMessagesRoute = typeof searchMessages

export const updateWorkspace = createRoute({
  path: "/workspaces/{workspaceSlug}",
  method: "patch",
  summary: "Update workspace settings",
  description:
    "Updates workspace name, logo, description, or website. Requires the organization:update authority.",
  tags: ["Workspaces"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceSlugParamsSchema,
    body: jsonContent({
      schema: updateWorkspaceRequestSchema,
      description: "Workspace fields to update",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateWorkspaceResponseSchema,
      description: "Updated workspace",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UpdateWorkspaceRoute = typeof updateWorkspace
