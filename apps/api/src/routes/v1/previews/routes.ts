import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { previewRateLimit } from "@/middleware/rate-limit"
import {
  previewParamsSchema,
  previewResponseSchema,
  previewSeenRequestSchema,
  previewSeenResponseSchema,
  previewViewResponseSchema,
} from "@/routes/v1/previews/schema"

// No auth middleware: a public link answers signed-out visitors. The
// handlers read the caller's session when there is one.

const errors = {
  [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
  [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
}

export const getPreview = createRoute({
  path: "/previews/{token}",
  method: "get",
  summary: "Read a preview link",
  description:
    "What a preview link opens and what the caller may do there. Starts nothing in the sandbox.",
  tags: ["Previews"],
  middleware: [previewRateLimit] as const,
  request: { params: previewParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: previewResponseSchema,
      description: "The preview, or why the caller can't see it",
    }),
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetPreviewRoute = typeof getPreview

export const openPreviewView = createRoute({
  path: "/previews/{token}/view",
  method: "post",
  summary: "Open a preview link's live view",
  description:
    "Returns the session browser's live view for this caller. A signed-out visitor of a public link watches only while someone signed in has the browser open.",
  tags: ["Previews"],
  middleware: [previewRateLimit] as const,
  request: { params: previewParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: previewViewResponseSchema,
      description: "The live view, or why it isn't showing",
    }),
    ...errors,
  },
})

export type OpenPreviewViewRoute = typeof openPreviewView

export const markPreviewSeen = createRoute({
  path: "/previews/{token}/seen",
  method: "post",
  summary: "Say a preview link's live view is open",
  description:
    "Sent every minute by a signed-in viewer's page. With `annotations`, also stores the page's annotations.",
  tags: ["Previews"],
  middleware: [previewRateLimit] as const,
  request: {
    params: previewParamsSchema,
    body: jsonContent({
      schema: previewSeenRequestSchema,
      description: "Whether the annotations changed",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: previewSeenResponseSchema,
      description: "Recorded",
    }),
    ...errors,
  },
})

export type MarkPreviewSeenRoute = typeof markPreviewSeen
