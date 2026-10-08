import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import { unauthorizedSchema } from "@/lib/helpers/openapi/schemas"
import { siteLookupRateLimit } from "@/middleware/rate-limit"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  companySiteQuerySchema,
  companySiteResponseSchema,
} from "@/routes/v1/onboarding/schema"

export const getCompanySite = createRoute({
  path: "/onboarding/site",
  method: "get",
  summary: "Read a company website for onboarding",
  description:
    "Suggests a workspace name and a one-line description from a company homepage. Fields are null when the site has nothing usable.",
  tags: ["Onboarding"],
  middleware: [sessionAuthMiddleware, siteLookupRateLimit] as const,
  request: {
    query: companySiteQuerySchema,
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: companySiteResponseSchema,
      description: "Suggested name and description",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  },
})

export type GetCompanySiteRoute = typeof getCompanySite
