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
  connectAttioRequestSchema,
  connectAttioResponseSchema,
  connectCloudwatchRequestSchema,
  connectCloudwatchResponseSchema,
  connectDatadogRequestSchema,
  connectDatadogResponseSchema,
  connectGithubRequestSchema,
  connectGithubResponseSchema,
  connectionIdParamsSchema,
  connectLinearRequestSchema,
  connectLinearResponseSchema,
  connectNotionRequestSchema,
  connectNotionResponseSchema,
  disconnectResponseSchema,
  integrationsWorkspaceParamsSchema,
  listIntegrationsResponseSchema,
  updateGithubRepoConfigRequestSchema,
  updateGithubRepoConfigResponseSchema,
  updateIntegrationRequestSchema,
  updateIntegrationResponseSchema,
} from "@/routes/v1/integrations/schema"

export const listIntegrations = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations",
  method: "get",
  summary: "List a workspace's integrations",
  description: "Returns each provider's connection status + connect link.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: integrationsWorkspaceParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listIntegrationsResponseSchema,
      description: "Integration statuses",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const connectGithub = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/github/connect",
  method: "post",
  summary: "Link a GitHub App installation to a workspace",
  description:
    "Called by the post-install setup redirect with the installation id.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: integrationsWorkspaceParamsSchema,
    body: jsonContent({
      schema: connectGithubRequestSchema,
      description: "The GitHub App installation id",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: connectGithubResponseSchema,
      description: "Connected",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const connectLinear = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/linear/connect",
  method: "post",
  summary: "Link a Linear workspace to a workspace",
  description:
    "Called by the OAuth callback with the authorization code; exchanges it for tokens.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: integrationsWorkspaceParamsSchema,
    body: jsonContent({
      schema: connectLinearRequestSchema,
      description: "The Linear OAuth authorization code",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: connectLinearResponseSchema,
      description: "Connected",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const connectDatadog = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/datadog/connect",
  method: "post",
  summary: "Link a Datadog account to a workspace",
  description:
    "Verifies the pasted API + application keys against the selected site, then stores them encrypted.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: integrationsWorkspaceParamsSchema,
    body: jsonContent({
      schema: connectDatadogRequestSchema,
      description: "The Datadog site + API/application keys",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: connectDatadogResponseSchema,
      description: "Connected",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const connectCloudwatch = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/cloudwatch/connect",
  method: "post",
  summary: "Link an AWS CloudWatch account to a workspace",
  description:
    "Verifies the pasted access key against the selected region (STS identity + logs read), then stores it encrypted.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: integrationsWorkspaceParamsSchema,
    body: jsonContent({
      schema: connectCloudwatchRequestSchema,
      description: "The AWS region + access key pair",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: connectCloudwatchResponseSchema,
      description: "Connected",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const connectAttio = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/attio/connect",
  method: "post",
  summary: "Link an Attio workspace to a workspace",
  description:
    "Exchanges an Attio OAuth authorization code and stores the workspace-scoped, read-only token encrypted.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: integrationsWorkspaceParamsSchema,
    body: jsonContent({
      schema: connectAttioRequestSchema,
      description: "The Attio OAuth authorization code",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: connectAttioResponseSchema,
      description: "Connected",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const connectNotion = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/notion/connect",
  method: "post",
  summary: "Link a Notion authorization to a workspace",
  description:
    "Exchanges a Notion OAuth code and stores the org-shared, page-picker-scoped read-only token pair encrypted. Requires a Lor workspace admin.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: integrationsWorkspaceParamsSchema,
    body: jsonContent({
      schema: connectNotionRequestSchema,
      description: "The Notion OAuth authorization code and signed state",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: connectNotionResponseSchema,
      description: "Connected",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const updateIntegration = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/{connectionId}",
  method: "patch",
  summary: "Update an integration's settings",
  description: "Sets or clears the channel that receives provider activity.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: connectionIdParamsSchema,
    body: jsonContent({
      schema: updateIntegrationRequestSchema,
      description: "The notification channel (null to disable)",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateIntegrationResponseSchema,
      description: "Updated",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const updateGithubRepoConfig = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/{connectionId}/repos",
  method: "patch",
  summary: "Set a repository's pull request base branch",
  description:
    "Overrides the branch Lor's code actions open pull requests against for one repository; null resets to the repository's default branch.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: connectionIdParamsSchema,
    body: jsonContent({
      schema: updateGithubRepoConfigRequestSchema,
      description: "The repository and its base branch (null to reset)",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateGithubRepoConfigResponseSchema,
      description: "Updated",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const disconnectIntegration = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/{connectionId}",
  method: "delete",
  summary: "Disconnect an integration",
  description: "Removes the connection; its ingested sources are purged.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: connectionIdParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: disconnectResponseSchema,
      description: "Disconnected",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListIntegrationsRoute = typeof listIntegrations
export type ConnectGithubRoute = typeof connectGithub
export type ConnectLinearRoute = typeof connectLinear
export type ConnectAttioRoute = typeof connectAttio
export type ConnectNotionRoute = typeof connectNotion
export type ConnectDatadogRoute = typeof connectDatadog
export type ConnectCloudwatchRoute = typeof connectCloudwatch
export type UpdateIntegrationRoute = typeof updateIntegration
export type UpdateGithubRepoConfigRoute = typeof updateGithubRepoConfig
export type DisconnectIntegrationRoute = typeof disconnectIntegration
