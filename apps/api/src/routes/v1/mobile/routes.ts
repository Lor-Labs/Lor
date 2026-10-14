import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import { mobileVersionResponseSchema } from "@/routes/v1/mobile/schema"

// Public: a signed-out app on an old build must still learn it's too old.
export const getMobileVersion = createRoute({
  path: "/mobile/version",
  method: "get",
  summary: "Get the oldest supported phone app version",
  description:
    "The phone app checks this on launch and on return to the foreground, and blocks with an update screen when it is older than minimumVersion.",
  tags: ["Mobile"],
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: mobileVersionResponseSchema,
      description: "Oldest supported version and where to update",
    }),
  },
})

export type GetMobileVersionRoute = typeof getMobileVersion
