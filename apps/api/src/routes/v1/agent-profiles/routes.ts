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
  agentProfileIdParamsSchema,
  agentProfileSchema,
  agentProfilesWorkspaceParamsSchema,
  createAgentProfileRequestSchema,
  deleteAgentProfileResponseSchema,
  listAgentProfilesResponseSchema,
  updateAgentProfileRequestSchema,
} from "@/routes/v1/agent-profiles/schema"

export const listAgentProfiles = createRoute({
  path: "/workspaces/{workspaceSlug}/agent-profiles",
  method: "get",
  summary: "List a workspace's Merlin profiles",
  description:
    "Returns the workspace's capability profiles plus the capabilities it can currently grant.",
  tags: ["Agent Profiles"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: agentProfilesWorkspaceParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listAgentProfilesResponseSchema,
      description: "Profiles + available capabilities",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const createAgentProfile = createRoute({
  path: "/workspaces/{workspaceSlug}/agent-profiles",
  method: "post",
  summary: "Create a Merlin profile",
  description: "Creates a capability profile that channels can be assigned to.",
  tags: ["Agent Profiles"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: agentProfilesWorkspaceParamsSchema,
    body: jsonContent({
      schema: createAgentProfileRequestSchema,
      description: "Profile name + granted capabilities",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: agentProfileSchema,
      description: "Created profile",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const updateAgentProfile = createRoute({
  path: "/workspaces/{workspaceSlug}/agent-profiles/{profileId}",
  method: "patch",
  summary: "Update a Merlin profile",
  description: "Renames a profile or changes the capabilities it grants.",
  tags: ["Agent Profiles"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: agentProfileIdParamsSchema,
    body: jsonContent({
      schema: updateAgentProfileRequestSchema,
      description: "Fields to update",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: agentProfileSchema,
      description: "Updated profile",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const deleteAgentProfile = createRoute({
  path: "/workspaces/{workspaceSlug}/agent-profiles/{profileId}",
  method: "delete",
  summary: "Delete a Merlin profile",
  description:
    "Deletes a profile. The default profile can't be deleted; channels using a deleted profile fall back to the default.",
  tags: ["Agent Profiles"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: agentProfileIdParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteAgentProfileResponseSchema,
      description: "Deleted",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListAgentProfilesRoute = typeof listAgentProfiles
export type CreateAgentProfileRoute = typeof createAgentProfile
export type UpdateAgentProfileRoute = typeof updateAgentProfile
export type DeleteAgentProfileRoute = typeof deleteAgentProfile
