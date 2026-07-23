import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  internalServerErrorSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  pushTokenSuccessResponseSchema,
  registerPushTokenBodySchema,
  removePushTokenBodySchema,
} from "@/routes/v1/push-tokens/schema"

export const registerPushToken = createRoute({
  path: "/push-tokens",
  method: "post",
  summary: "Register a push token",
  description:
    "Registers (or re-associates) a device push token for the current user.",
  tags: ["Push Tokens"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    body: jsonContent({
      schema: registerPushTokenBodySchema,
      description: "Push token to register",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: pushTokenSuccessResponseSchema,
      description: "Push token registered",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type RegisterPushTokenRoute = typeof registerPushToken

export const removePushToken = createRoute({
  path: "/push-tokens",
  method: "delete",
  summary: "Remove a push token",
  description:
    "Removes a device push token so the device stops receiving pushes (sign-out).",
  tags: ["Push Tokens"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    body: jsonContent({
      schema: removePushTokenBodySchema,
      description: "Push token to remove",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: pushTokenSuccessResponseSchema,
      description: "Push token removed",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type RemovePushTokenRoute = typeof removePushToken
