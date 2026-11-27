import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  forbiddenSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  addChatPeopleRequestSchema,
  chatParamsSchema,
  chatPeopleChangedResponseSchema,
  chatPersonParamsSchema,
  chatWorkspaceParamsSchema,
  listAgentMessagesResponseSchema,
  listChatPeopleResponseSchema,
  listChatsQuerySchema,
  listChatsResponseSchema,
  updateChatRequestSchema,
  updateChatResponseSchema,
} from "@/routes/v1/chats/schema"

export const listChats = createRoute({
  path: "/workspaces/{workspaceSlug}/chats",
  method: "get",
  summary: "List the caller's chats",
  description:
    "The chats the caller is in and has not hidden, each with its last message, its agents and the people in it (reference/agents-and-chats.md). With archived=true, the archived chats they can see instead.",
  tags: ["Chats"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: chatWorkspaceParamsSchema, query: listChatsQuerySchema },
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

export const archiveChat = createRoute({
  path: "/workspaces/{workspaceSlug}/chats/{channelId}/archive",
  method: "post",
  summary: "Archive a chat for everyone",
  description:
    "Makes the chat read-only, stops its agents there and takes it out of everyone's sidebar. Takes channel:update.",
  tags: ["Chats"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: chatParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: chatPeopleChangedResponseSchema,
      description: "Archived",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export type ArchiveChatRoute = typeof archiveChat

export const unarchiveChat = createRoute({
  path: "/workspaces/{workspaceSlug}/chats/{channelId}/unarchive",
  method: "post",
  summary: "Unarchive a chat",
  description:
    "Undoes an archive: the chat takes messages again, returns to its people's sidebars, and the Loops and follow-ups archiving paused start again. Takes channel:update.",
  tags: ["Chats"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: chatParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: chatPeopleChangedResponseSchema,
      description: "Unarchived",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export type UnarchiveChatRoute = typeof unarchiveChat

export const listChatPeople = createRoute({
  path: "/workspaces/{workspaceSlug}/chats/{channelId}/people",
  method: "get",
  summary: "List the people in a chat",
  description: "Everyone in the chat, for anyone who can see it.",
  tags: ["Chats"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: chatParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChatPeopleResponseSchema,
      description: "The people in the chat",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const addChatPeople = createRoute({
  path: "/workspaces/{workspaceSlug}/chats/{channelId}/people",
  method: "post",
  summary: "Add people to a chat",
  description:
    "Puts people in a chat they can see. Adding someone to a private chat lets them see it, which takes channel:update.",
  tags: ["Chats"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: chatParamsSchema,
    body: jsonContent({
      schema: addChatPeopleRequestSchema,
      description: "Who to add",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: chatPeopleChangedResponseSchema,
      description: "Added",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const removeChatPerson = createRoute({
  path: "/workspaces/{workspaceSlug}/chats/{channelId}/people/{userId}",
  method: "delete",
  summary: "Leave a chat, or remove someone from it",
  description:
    "Anyone can leave a chat they are in. Removing someone else takes channel:update.",
  tags: ["Chats"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: chatPersonParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: chatPeopleChangedResponseSchema,
      description: "Removed",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const listAgentMessages = createRoute({
  path: "/workspaces/{workspaceSlug}/chats/{channelId}/agent-messages",
  method: "get",
  summary: "List what a chat's agents said to each other",
  description:
    "The agents' own chat about this chat's work: read-only, for anyone who can see the chat. The newest 200, oldest first.",
  tags: ["Chats"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: chatParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listAgentMessagesResponseSchema,
      description: "The messages",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export type ListAgentMessagesRoute = typeof listAgentMessages
export type ListChatsRoute = typeof listChats
export type ListChatPeopleRoute = typeof listChatPeople
export type AddChatPeopleRoute = typeof addChatPeople
export type RemoveChatPersonRoute = typeof removeChatPerson
export type UpdateChatRoute = typeof updateChat
