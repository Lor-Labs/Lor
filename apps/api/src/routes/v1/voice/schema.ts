import { z } from "@hono/zod-openapi"

export const voiceChannelParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

export const voiceSessionParamsSchema = z.object({
  sessionId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "sessionId", in: "path", required: true },
    }),
})

export const leaveVoiceSessionResponseSchema = z.object({
  success: z.literal(true),
})

export const joinVoiceChannelResponseSchema = z.object({
  url: z.string(),
  token: z.string(),
  sessionId: z.string().uuid(),
  participantId: z.string().uuid(),
})
