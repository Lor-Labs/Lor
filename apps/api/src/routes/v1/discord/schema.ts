import { z } from "@hono/zod-openapi"

export const discordChannelParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
  channelId: z
    .string()
    .uuid()
    .openapi({ param: { name: "channelId", in: "path", required: true } }),
})

export const discordStatusSchema = z.object({
  // Whether this Lor server has a Discord bot set up at all.
  available: z.boolean(),
  inviteUrl: z.string().nullable(),
  link: z
    .object({
      guildName: z.string().nullable(),
      channelName: z.string().nullable(),
      url: z.string(),
      linkedAt: z.string(),
    })
    .nullable(),
})

export const discordLinkCodeSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
  inviteUrl: z.string().nullable(),
})

export const discordSuccessSchema = z.object({ success: z.literal(true) })

export const discordConnectBodySchema = z.object({ token: z.string().min(1) })

export const discordAccountSchema = z.object({
  account: z.object({ username: z.string() }).nullable(),
})
