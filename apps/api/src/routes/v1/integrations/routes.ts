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
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  completeGithubSetupRequestSchema,
  completeGithubSetupResponseSchema,
  connectAttioRequestSchema,
  connectAttioResponseSchema,
  connectBetterstackRequestSchema,
  connectBetterstackResponseSchema,
  connectCloudwatchRequestSchema,
  connectCloudwatchResponseSchema,
  connectDatadogRequestSchema,
  connectDatadogResponseSchema,
  connectionIdParamsSchema,
  connectLinearRequestSchema,
  connectLinearResponseSchema,
  connectNotionRequestSchema,
  connectNotionResponseSchema,
  createListenerRequestSchema,
  createListenerResponseSchema,
  disconnectResponseSchema,
  integrationOkResponseSchema,
  integrationsWorkspaceParamsSchema,
  listenerActivityResponseSchema,
  listenerParamsSchema,
  listenerSuggestionsResponseSchema,
  listIntegrationsResponseSchema,
  startGithubConnectResponseSchema,
  updateIntegrationToolsRequestSchema,
  updateListenerRequestSchema,
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

export const startGithubConnect = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/github/connect-url",
  method: "post",
  summary: "Start connecting GitHub",
  description:
    "Records which workspace the caller is connecting and returns the GitHub App install URL with a signed state.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: integrationsWorkspaceParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: startGithubConnectResponseSchema,
      description: "Install URL",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const completeGithubSetup = createRoute({
  path: "/integrations/github/setup",
  method: "post",
  summary: "Link a GitHub App installation after install",
  description:
    "Called by the GitHub Setup URL page. The workspace comes from the signed state, else from the caller's recorded connect intent.",
  tags: ["Integrations"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    body: jsonContent({
      schema: completeGithubSetupRequestSchema,
      description: "The installation id and the returned state",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: completeGithubSetupResponseSchema,
      description: "Connected",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
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
    "Exchanges an Attio OAuth authorization code and stores the workspace-scoped token encrypted. Available read/write tools are selected separately.",
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
    "Exchanges a Notion OAuth code and stores the org-shared, page-picker-scoped token pair encrypted. Available tools are selected separately. Requires a Lor workspace admin.",
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

export const createListener = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/{connectionId}/listeners",
  method: "post",
  summary: "Add a listener to a connector event",
  description:
    "An agent starts listening to one of the connector's events and reports in a chat it is in. Several agents can listen to the same event, each once.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: connectionIdParamsSchema,
    body: jsonContent({
      schema: createListenerRequestSchema,
      description: "The event, the agent and the chat it reports in",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: createListenerResponseSchema,
      description: "Added",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const updateListener = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/{connectionId}/listeners/{listenerId}",
  method: "patch",
  summary: "Update a listener",
  description: "Changes the fields sent; the rest stay as saved.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: listenerParamsSchema,
    body: jsonContent({
      schema: updateListenerRequestSchema,
      description: "The fields to change",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: integrationOkResponseSchema,
      description: "Updated",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const deleteListener = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/{connectionId}/listeners/{listenerId}",
  method: "delete",
  summary: "Remove a listener",
  description: "The agent stops listening to the event.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: listenerParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: integrationOkResponseSchema,
      description: "Removed",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const listenerSuggestions = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/{connectionId}/suggestions",
  method: "get",
  summary: "Suggest which agent listens to each event",
  description:
    "For the connector's events nobody listens to yet: the agent whose role fits each one, and the chat it would report in. Suggestions only; nothing is saved.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: connectionIdParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listenerSuggestionsResponseSchema,
      description: "The suggestions",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const listenerActivity = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/{connectionId}/listeners/{listenerId}/activity",
  method: "get",
  summary: "A listener's recent activity",
  description:
    "What arrived for one listener and what became of each: woke the agent, waited, or was turned away by the filter.",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: listenerParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listenerActivityResponseSchema,
      description: "The deliveries",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
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
export type StartGithubConnectRoute = typeof startGithubConnect
export type CompleteGithubSetupRoute = typeof completeGithubSetup
export type ConnectLinearRoute = typeof connectLinear
export type ConnectAttioRoute = typeof connectAttio
export type ConnectNotionRoute = typeof connectNotion
export type ConnectDatadogRoute = typeof connectDatadog
export type ConnectCloudwatchRoute = typeof connectCloudwatch
export type CreateListenerRoute = typeof createListener
export type UpdateListenerRoute = typeof updateListener
export type DeleteListenerRoute = typeof deleteListener
export type ListenerSuggestionsRoute = typeof listenerSuggestions
export type ListenerActivityRoute = typeof listenerActivity
export type DisconnectIntegrationRoute = typeof disconnectIntegration

export const updateIntegrationTools = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/{connectionId}/tools",
  method: "patch",
  summary: "Select the tools a connector may use",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: connectionIdParamsSchema,
    body: jsonContent({
      schema: updateIntegrationToolsRequestSchema,
      description: "Explicit tool allowlist",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: integrationOkResponseSchema,
      description: "Tools updated",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})
export type UpdateIntegrationToolsRoute = typeof updateIntegrationTools

export const connectBetterstack = createRoute({
  path: "/workspaces/{workspaceSlug}/integrations/betterstack/connect",
  method: "post",
  summary: "Connect a Better Stack account",
  tags: ["Integrations"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: integrationsWorkspaceParamsSchema,
    body: jsonContent({
      schema: connectBetterstackRequestSchema,
      description: "Better Stack API token",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: connectBetterstackResponseSchema,
      description: "Connected",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
  },
})
export type ConnectBetterstackRoute = typeof connectBetterstack
