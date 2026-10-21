import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  internalServerErrorSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  getSandboxSettingsResponseSchema,
  updateSandboxSettingsBodySchema,
  updateSandboxSettingsResponseSchema,
} from "@/routes/v1/sandbox-settings/schema"

export const getSandboxSettings = createRoute({
  path: "/sandbox-settings",
  method: "get",
  summary: "Get sandbox settings",
  description:
    "Returns how Lor runs commands and file changes in its sandbox for turns the current user starts.",
  tags: ["Sandbox Settings"],
  middleware: [sessionAuthMiddleware] as const,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: getSandboxSettingsResponseSchema,
      description: "Sandbox settings",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetSandboxSettingsRoute = typeof getSandboxSettings

export const updateSandboxSettings = createRoute({
  path: "/sandbox-settings",
  method: "patch",
  summary: "Update sandbox settings",
  description:
    "Updates the current user's sandbox mode. Turns already running keep the mode they started with.",
  tags: ["Sandbox Settings"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    body: jsonContent({
      schema: updateSandboxSettingsBodySchema,
      description: "Sandbox mode",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateSandboxSettingsResponseSchema,
      description: "Updated sandbox settings",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UpdateSandboxSettingsRoute = typeof updateSandboxSettings
