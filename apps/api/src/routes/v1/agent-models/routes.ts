import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  agentModelsQuerySchema,
  agentModelsResponseSchema,
} from "@/routes/v1/agent-models/schema"
import { billingWorkspaceParamsSchema } from "@/routes/v1/billing/schema"

export const listAgentModels = createRoute({
  path: "/workspaces/{workspaceSlug}/agent-models",
  method: "get",
  summary: "List a harness's models",
  description:
    "The models a session's composer offers for a harness, with each model's effort levels and fast mode, read from the harness's own catalog.",
  tags: ["Sessions"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    query: agentModelsQuerySchema,
    params: billingWorkspaceParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: agentModelsResponseSchema,
      description: "The harness's models",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListAgentModelsRoute = typeof listAgentModels
