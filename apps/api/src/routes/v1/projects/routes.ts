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
  addProjectMemberRequestSchema,
  createProjectRequestSchema,
  listProjectsResponseSchema,
  projectDetailSchema,
  projectMemberParamsSchema,
  projectParamsSchema,
  successResponseSchema,
  updateProjectRequestSchema,
  workspaceSlugParamsSchema,
} from "@/routes/v1/projects/schema"

const commonErrors = {
  [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
  [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
} as const

export const listProjects = createRoute({
  path: "/workspaces/{workspaceSlug}/projects",
  method: "get",
  summary: "List projects",
  description:
    "Lists projects in the workspace that are visible to the caller (private projects only appear for their members).",
  tags: ["Projects"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceSlugParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listProjectsResponseSchema,
      description: "Visible projects",
    }),
    ...commonErrors,
  },
})

export const createProject = createRoute({
  path: "/workspaces/{workspaceSlug}/projects",
  method: "post",
  summary: "Create a project",
  description:
    "Creates a project: a lifecycle-scoped channel group with its own audience. Private projects restrict all contained channels to the selected members.",
  tags: ["Projects"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceSlugParamsSchema,
    body: jsonContent({
      schema: createProjectRequestSchema,
      description: "Project details",
    }),
  },
  responses: {
    [HttpStatusCodes.CREATED]: jsonContent({
      schema: projectDetailSchema,
      description: "Project created",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    ...commonErrors,
  },
})

export const getProject = createRoute({
  path: "/workspaces/{workspaceSlug}/projects/{projectId}",
  method: "get",
  summary: "Get a project",
  description: "Project details with members and channels.",
  tags: ["Projects"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: projectParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: projectDetailSchema,
      description: "Project",
    }),
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    ...commonErrors,
  },
})

export const updateProject = createRoute({
  path: "/workspaces/{workspaceSlug}/projects/{projectId}",
  method: "patch",
  summary: "Update a project",
  description: "Updates the project's name, description, or target date.",
  tags: ["Projects"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: projectParamsSchema,
    body: jsonContent({
      schema: updateProjectRequestSchema,
      description: "Fields to update",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: projectDetailSchema,
      description: "Updated project",
    }),
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    ...commonErrors,
  },
})

export const archiveProject = createRoute({
  path: "/workspaces/{workspaceSlug}/projects/{projectId}/archive",
  method: "post",
  summary: "Archive a project",
  description:
    "Locks all project channels read-only and starts archive synthesis: Lor distills the project into workspace memory and posts a closing summary. Irreversible in v1.",
  tags: ["Projects"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: projectParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: projectDetailSchema,
      description: "Project now archiving",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    ...commonErrors,
  },
})

export const addProjectMember = createRoute({
  path: "/workspaces/{workspaceSlug}/projects/{projectId}/members",
  method: "post",
  summary: "Add a project member",
  description:
    "Adds a workspace member to the project, granting access to all of its channels.",
  tags: ["Projects"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: projectParamsSchema,
    body: jsonContent({
      schema: addProjectMemberRequestSchema,
      description: "User to add",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: successResponseSchema,
      description: "Member added",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    ...commonErrors,
  },
})

export const removeProjectMember = createRoute({
  path: "/workspaces/{workspaceSlug}/projects/{projectId}/members/{userId}",
  method: "delete",
  summary: "Remove a project member",
  description:
    "Removes a member from the project, revoking access to all of its channels. The last member cannot be removed.",
  tags: ["Projects"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: projectMemberParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: successResponseSchema,
      description: "Member removed",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    ...commonErrors,
  },
})

export type ListProjectsRoute = typeof listProjects
export type CreateProjectRoute = typeof createProject
export type GetProjectRoute = typeof getProject
export type UpdateProjectRoute = typeof updateProject
export type ArchiveProjectRoute = typeof archiveProject
export type AddProjectMemberRoute = typeof addProjectMember
export type RemoveProjectMemberRoute = typeof removeProjectMember
