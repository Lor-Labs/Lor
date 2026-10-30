import { z } from "@hono/zod-openapi"
import { insertPushTokenSchema } from "@repo/db/schema"

// Expo push tokens only (the mobile app registers getExpoPushTokenAsync).
const EXPO_PUSH_TOKEN_REGEX = /^Expo(?:nent)?PushToken\[[^[\]\s]{1,200}\]$/

export const registerPushTokenBodySchema = insertPushTokenSchema.extend({
  token: z.string().max(256).regex(EXPO_PUSH_TOKEN_REGEX),
})
export const removePushTokenBodySchema = insertPushTokenSchema.pick({
  token: true,
})

export const pushTokenSuccessResponseSchema = z.object({
  success: z.literal(true),
})
