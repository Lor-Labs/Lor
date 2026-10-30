import { createRoute } from "@hono/zod-openapi"
import jsonContent from "@/lib/helpers/openapi/json-content"
import { internalServerErrorSchema } from "@/lib/helpers/openapi/schemas"
import { waitlistRateLimit } from "@/middleware/rate-limit"
import {
  waitlistErrorSchema,
  waitlistRequestSchema,
  waitlistSuccessSchema,
} from "@/routes/waitlist/schema"

export const createWaitlistEntry = createRoute({
  path: "/waitlist",
  method: "post",
  summary: "Join the waitlist",
  description: "Adds an email address to the Lor waitlist.",
  tags: ["Waitlist"],
  middleware: [waitlistRateLimit] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: waitlistRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonContent({
      schema: waitlistSuccessSchema,
      description:
        "On the waitlist (also returned when the email was already on it)",
    }),
    400: jsonContent({
      schema: waitlistErrorSchema,
      description: "Invalid email",
    }),
    500: internalServerErrorSchema,
  },
})

export type CreateWaitlistEntryRoute = typeof createWaitlistEntry
