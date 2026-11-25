import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  chatParamsSchema,
  chatWorkspaceParamsSchema,
  listChatsResponseSchema,
  updateChatRequestSchema,
  updateChatResponseSchema,
} from "@/routes/v1/chats/schema"

export const listChats = createRoute({
  path: "/workspaces/{workspaceSlug}/chats",
  method: "get",
  summary: "List the caller's chats",
  description:
    "The chats the caller is in and has not hidden, each with its last message, its agents and the people in it (reference/agents-and-chats.md).",
  tags: ["Chats"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: chatWorkspaceParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChatsResponseSchema,
      description: "The chats",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const updateChat = createRoute({
  path: "/workspaces/{workspaceSlug}/chats/{channelId}",
  method: "patch",
  summary: "Pin or hide a chat for the caller",
  description:
    "Pins and hides are each person's own. Hiding puts the chat away until its next message.",
  tags: ["Chats"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: chatParamsSchema,
    body: jsonContent({
      schema: updateChatRequestSchema,
      description: "What to change",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateChatResponseSchema,
      description: "The caller's state for the chat",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export type ListChatsRoute = typeof listChats
export type UpdateChatRoute = typeof updateChat
