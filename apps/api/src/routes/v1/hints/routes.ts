import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import { unauthorizedSchema } from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  dismissHintResponseSchema,
  hintParamsSchema,
  listHintsResponseSchema,
} from "@/routes/v1/hints/schema"

export const listHints = createRoute({
  path: "/hints",
  method: "get",
  summary: "List dismissed hints",
  description: "Returns the product hints the current user has dismissed.",
  tags: ["Hints"],
  middleware: [sessionAuthMiddleware] as const,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listHintsResponseSchema,
      description: "Dismissed hint keys",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  },
})

export type ListHintsRoute = typeof listHints

export const dismissHint = createRoute({
  path: "/hints/{key}",
  method: "put",
  summary: "Dismiss a hint",
  description:
    "Marks a product hint as seen for the current user on every device.",
  tags: ["Hints"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: hintParamsSchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: dismissHintResponseSchema,
      description: "Hint dismissed",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  },
})

export type DismissHintRoute = typeof dismissHint
