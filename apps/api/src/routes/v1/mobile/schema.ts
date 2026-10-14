import { z } from "@hono/zod-openapi"

export const mobileVersionResponseSchema = z.object({
  // Null = every app version is still supported.
  minimumVersion: z.string().nullable(),
  // Where an app below the minimum sends people to update.
  updateUrl: z.string().url(),
})
