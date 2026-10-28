import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  internalServerErrorSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  agentModelsQuerySchema,
  agentModelsResponseSchema,
} from "@/routes/v1/agent-models/schema"

export const listAgentModels = createRoute({
  path: "/agent-models",
  method: "get",
  summary: "List a harness's models",
  description:
    "The models a session's composer offers for a harness, with each model's effort levels and fast mode, read from the harness's own catalog.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { query: agentModelsQuerySchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: agentModelsResponseSchema,
      description: "The harness's models",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListAgentModelsRoute = typeof listAgentModels
