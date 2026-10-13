import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  listThreadSubscribersResponseSchema,
  subscribeEveryoneResponseSchema,
  threadSubscriberParamsSchema,
  threadSubscribersParamsSchema,
  threadSubscriptionChangeResponseSchema,
} from "@/routes/v1/thread-subscriptions/schema"

const SUBSCRIBERS_PATH =
  "/workspaces/{workspaceSlug}/channels/{channelId}/threads/{threadRootId}/subscribers"

const errorResponses = {
  [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
}

export const listThreadSubscribers = createRoute({
  path: SUBSCRIBERS_PATH,
  method: "get",
  summary: "List a thread's subscribers",
  description:
    "The people who follow a Lor session, human thread or call chat: its sidebar row and notifications reach them.",
  tags: ["Threads"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: threadSubscribersParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listThreadSubscribersResponseSchema,
      description: "Subscribers, oldest first",
    }),
    ...errorResponses,
  },
})

export type ListThreadSubscribersRoute = typeof listThreadSubscribers

export const addThreadSubscriber = createRoute({
  path: `${SUBSCRIBERS_PATH}/{userId}`,
  method: "put",
  summary: "Subscribe someone to a thread",
  description:
    "Subscribes the caller (subscribe) or anyone else who can see the channel (add). Idempotent.",
  tags: ["Threads"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: threadSubscriberParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: threadSubscriptionChangeResponseSchema,
      description: "Subscribed",
    }),
    ...errorResponses,
  },
})

export type AddThreadSubscriberRoute = typeof addThreadSubscriber

export const subscribeEveryone = createRoute({
  path: `${SUBSCRIBERS_PATH}/everyone`,
  method: "post",
  summary: "Subscribe everyone in the channel to a thread",
  description:
    "Subscribes every person who can see the channel, so the session or thread shows in each of their sidebars. Sends no per-person notification.",
  tags: ["Threads"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: threadSubscribersParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: subscribeEveryoneResponseSchema,
      description: "How many people were newly subscribed",
    }),
    ...errorResponses,
  },
})

export type SubscribeEveryoneRoute = typeof subscribeEveryone

export const removeThreadSubscriber = createRoute({
  path: `${SUBSCRIBERS_PATH}/{userId}`,
  method: "delete",
  summary: "Unsubscribe someone from a thread",
  description:
    "Unsubscribes the caller or anyone else. A later mention or message subscribes them again.",
  tags: ["Threads"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: threadSubscriberParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: threadSubscriptionChangeResponseSchema,
      description: "Unsubscribed",
    }),
    ...errorResponses,
  },
})

export type RemoveThreadSubscriberRoute = typeof removeThreadSubscriber
