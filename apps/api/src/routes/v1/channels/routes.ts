import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { connectorLookupRateLimit } from "@/middleware/rate-limit"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  channelConnectorParamsSchema,
  channelParamsSchema,
  channelResponseSchema,
  connectorFilesQuerySchema,
  connectorSearchQuerySchema,
  connectorSearchResponseSchema,
  createChannelRequestSchema,
  createChannelResponseSchema,
  deleteChannelResponseSchema,
  listChannelConnectorsResponseSchema,
  listChannelsResponseSchema,
  listConnectorScopesResponseSchema,
  listMessagesQuerySchema,
  listMessagesResponseSchema,
  listPinnedMessagesResponseSchema,
  listThreadActivityResponseSchema,
  listThreadRepliesResponseSchema,
  markThreadReadResponseSchema,
  messageIdParamsSchema,
  messageLocationParamsSchema,
  messageLocationResponseSchema,
  reorderChannelsRequestSchema,
  reorderChannelsResponseSchema,
  threadReadParamsSchema,
  togglePinResponseSchema,
  updateChannelRequestSchema,
  updateChannelResponseSchema,
  workspaceSlugParamsSchema,
} from "@/routes/v1/channels/schema"

export const listChannels = createRoute({
  path: "/workspaces/{workspaceSlug}/channels",
  method: "get",
  summary: "List channels",
  description: "Lists all channels in the specified workspace.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceSlugParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChannelsResponseSchema,
      description: "List of channels",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const createChannel = createRoute({
  path: "/workspaces/{workspaceSlug}/channels",
  method: "post",
  summary: "Create a channel",
  description: "Creates a new channel in the specified workspace.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceSlugParamsSchema,
    body: jsonContent({
      schema: createChannelRequestSchema,
      description: "Channel details",
    }),
  },
  responses: {
    [HttpStatusCodes.CREATED]: jsonContent({
      schema: createChannelResponseSchema,
      description: "Channel created",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const reorderChannels = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/reorder",
  method: "patch",
  summary: "Reorder channels",
  description:
    "Batch-update channel positions and parent categories within the specified workspace.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: workspaceSlugParamsSchema,
    body: jsonContent({
      schema: reorderChannelsRequestSchema,
      description: "Channel positions to update",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: reorderChannelsResponseSchema,
      description: "Channels reordered",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const getChannel = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}",
  method: "get",
  summary: "Get a channel",
  description: "Gets a single channel by ID within the specified workspace.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: channelParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: channelResponseSchema,
      description: "Channel",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const listChannelMessages = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/messages",
  method: "get",
  summary: "List channel messages",
  description: "Returns paginated messages for a channel.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: channelParamsSchema,
    query: listMessagesQuerySchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listMessagesResponseSchema,
      description: "Paginated messages",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const updateChannel = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}",
  method: "patch",
  summary: "Update a channel",
  description:
    "Updates a channel's name, topic, or other properties. Requires channel:update permission.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: channelParamsSchema,
    body: jsonContent({
      schema: updateChannelRequestSchema,
      description: "Channel fields to update",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateChannelResponseSchema,
      description: "Updated channel",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const deleteChannel = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}",
  method: "delete",
  summary: "Delete a channel",
  description:
    "Permanently deletes a channel and all its messages. Requires channel:delete permission.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: channelParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteChannelResponseSchema,
      description: "Channel deleted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const toggleMessagePin = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/messages/{messageId}/pin",
  method: "patch",
  summary: "Toggle message pin",
  description:
    "Pins or unpins a message in the channel. Requires message:pin permission.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: messageIdParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: togglePinResponseSchema,
      description: "Pin toggled",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const listPinnedMessages = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/pins",
  method: "get",
  summary: "List pinned messages",
  description: "Returns all pinned messages in a channel.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: channelParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listPinnedMessagesResponseSchema,
      description: "Pinned messages",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const listThreadReplies = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/messages/{messageId}/thread",
  method: "get",
  summary: "List thread replies",
  description:
    "Returns paginated replies under a thread root, using cursor pagination.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: messageIdParamsSchema,
    query: listMessagesQuerySchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listThreadRepliesResponseSchema,
      description: "Paginated thread replies",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const listThreadActivity = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/thread-activity",
  method: "get",
  summary: "List unread thread activity",
  description:
    "Returns threads in the channel that received replies from others since the caller last read the channel, for the activity cards at the bottom of the feed.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: channelParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listThreadActivityResponseSchema,
      description: "Unread thread activity",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const markThreadRead = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/threads/{threadRootId}/read",
  method: "post",
  summary: "Mark a thread as read",
  description:
    "Advances the caller's per-thread read cursor to now. Clears the thread from the thread-activity dock on all the caller's devices.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: threadReadParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: markThreadReadResponseSchema,
      description: "Thread marked read",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const getMessageLocation = createRoute({
  path: "/workspaces/{workspaceSlug}/messages/{messageId}",
  method: "get",
  summary: "Resolve a message's location",
  description:
    "Returns the channel (and thread root) a message belongs to, for jump-to-message navigation. Workspace-scoped.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: messageLocationParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: messageLocationResponseSchema,
      description: "Message location",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const listChannelConnectors = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/connectors",
  method: "get",
  summary: "List the connectors attachable in a channel",
  description:
    "Connected workspace connectors that this channel's agent profile grants and that have attachable records. Backs the composer's + menu, which prefetches it so availability shows instantly.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: channelParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChannelConnectorsResponseSchema,
      description: "Attachable connectors",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const searchChannelConnector = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/connectors/{provider}/search",
  method: "get",
  summary: "Search a connector's attachable records",
  description:
    "Returns records (issues, pull requests, pages) as title + url for the composer's attach menu. An empty query returns recent records where the provider supports it. Gated by the same channel capabilities as the connector list.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware, connectorLookupRateLimit] as const,
  request: {
    params: channelConnectorParamsSchema,
    query: connectorSearchQuerySchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: connectorSearchResponseSchema,
      description: "Matching records",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const listConnectorScopes = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/connectors/{provider}/scopes",
  method: "get",
  summary: "List the containers a connector's files live in",
  description:
    "GitHub returns the installation's repositories. Connectors without file browsing return an empty list.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware, connectorLookupRateLimit] as const,
  request: { params: channelConnectorParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listConnectorScopesResponseSchema,
      description: "Available scopes",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const searchConnectorFiles = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/connectors/{provider}/files",
  method: "get",
  summary: "Search a scope's file and folder paths",
  description:
    "Filters the container's full path listing (for GitHub, one cached recursive git tree per repo). An empty query returns the root entries, folders first.",
  tags: ["Channels"],
  middleware: [workspaceAuthMiddleware, connectorLookupRateLimit] as const,
  request: {
    params: channelConnectorParamsSchema,
    query: connectorFilesQuerySchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: connectorSearchResponseSchema,
      description: "Matching paths",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListChannelsRoute = typeof listChannels
export type CreateChannelRoute = typeof createChannel
export type ReorderChannelsRoute = typeof reorderChannels
export type GetChannelRoute = typeof getChannel
export type UpdateChannelRoute = typeof updateChannel
export type DeleteChannelRoute = typeof deleteChannel
export type ListChannelMessagesRoute = typeof listChannelMessages
export type ToggleMessagePinRoute = typeof toggleMessagePin
export type ListPinnedMessagesRoute = typeof listPinnedMessages
export type ListThreadRepliesRoute = typeof listThreadReplies
export type ListThreadActivityRoute = typeof listThreadActivity
export type MarkThreadReadRoute = typeof markThreadRead
export type GetMessageLocationRoute = typeof getMessageLocation
export type ListChannelConnectorsRoute = typeof listChannelConnectors
export type SearchChannelConnectorRoute = typeof searchChannelConnector
export type ListConnectorScopesRoute = typeof listConnectorScopes
export type SearchConnectorFilesRoute = typeof searchConnectorFiles
