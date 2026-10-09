import { z } from "@hono/zod-openapi"
import { threadReadParamsSchema } from "@/routes/v1/channels/schema"

export const threadSubscribersParamsSchema = threadReadParamsSchema

export const threadSubscriberParamsSchema = threadReadParamsSchema.extend({
  userId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "userId", in: "path", required: true },
      example: "00000000-0000-0000-0000-000000000000",
    }),
})

export const threadSubscriberSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  image: z.string().nullable(),
  avatarColor: z.string().nullable(),
})

export const listThreadSubscribersResponseSchema = z.object({
  subscribers: z.array(threadSubscriberSchema),
})

export const threadSubscriptionChangeResponseSchema = z.object({
  success: z.literal(true),
})
