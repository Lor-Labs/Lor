import { z } from "@hono/zod-openapi"
import { insertPushTokenSchema } from "@repo/db/schema"

export const registerPushTokenBodySchema = insertPushTokenSchema
export const removePushTokenBodySchema = insertPushTokenSchema.pick({
  token: true,
})

export const pushTokenSuccessResponseSchema = z.object({
  success: z.literal(true),
})
