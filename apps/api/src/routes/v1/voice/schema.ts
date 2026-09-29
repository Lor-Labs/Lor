import { z } from "@hono/zod-openapi"

export const voiceChannelParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

export const joinVoiceChannelResponseSchema = z.object({
  url: z.string(),
  token: z.string(),
})
