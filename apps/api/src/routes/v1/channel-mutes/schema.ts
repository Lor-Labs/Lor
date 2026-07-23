import { z } from "@hono/zod-openapi"

export const channelMuteParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

export const muteChannelBodySchema = z.object({
  // null = muted until the user turns it back on
  until: z.string().datetime().nullable(),
})

export const channelMuteSchema = z.object({
  channelId: z.string().uuid(),
  mutedUntil: z.string().datetime().nullable(),
})

export const listChannelMutesResponseSchema = z.object({
  mutes: z.array(channelMuteSchema),
})

export const muteChannelResponseSchema = z.object({
  success: z.literal(true),
  mute: channelMuteSchema,
})

export const unmuteChannelResponseSchema = z.object({
  success: z.literal(true),
})
