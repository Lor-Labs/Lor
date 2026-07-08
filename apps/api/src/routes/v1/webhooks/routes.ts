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
  channelWebhookParamsSchema,
  createChannelWebhookRequestSchema,
  createChannelWebhookResponseSchema,
  deleteChannelWebhookResponseSchema,
  listChannelWebhooksResponseSchema,
  updateChannelWebhookRequestSchema,
  updateChannelWebhookResponseSchema,
  webhookIdParamsSchema,
} from "@/routes/v1/webhooks/schema"

export const listChannelWebhooks = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/webhooks",
  method: "get",
  summary: "List a channel's webhooks",
  tags: ["Webhooks"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: channelWebhookParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChannelWebhooksResponseSchema,
      description: "The channel's webhooks",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const createChannelWebhook = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/webhooks",
  method: "post",
  summary: "Create a channel webhook",
  description:
    "Returns the webhook including its token — the execute URL is the credential.",
  tags: ["Webhooks"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: channelWebhookParamsSchema,
    body: jsonContent({
      schema: createChannelWebhookRequestSchema,
      description: "The webhook name",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: createChannelWebhookResponseSchema,
      description: "Created",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const updateChannelWebhook = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/webhooks/{webhookId}",
  method: "patch",
  summary: "Update a channel webhook",
  description: "Renames the webhook and/or sets or clears its avatar.",
  tags: ["Webhooks"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: webhookIdParamsSchema,
    body: jsonContent({
      schema: updateChannelWebhookRequestSchema,
      description: "Fields to update",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateChannelWebhookResponseSchema,
      description: "Updated",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export const deleteChannelWebhook = createRoute({
  path: "/workspaces/{workspaceSlug}/channels/{channelId}/webhooks/{webhookId}",
  method: "delete",
  summary: "Delete a channel webhook",
  tags: ["Webhooks"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: webhookIdParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteChannelWebhookResponseSchema,
      description: "Deleted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListChannelWebhooksRoute = typeof listChannelWebhooks
export type CreateChannelWebhookRoute = typeof createChannelWebhook
export type UpdateChannelWebhookRoute = typeof updateChannelWebhook
export type DeleteChannelWebhookRoute = typeof deleteChannelWebhook
