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

// Places in Discord (reference/agents-and-chats.md, decision 51).
export const discordWorkspaceParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const discordServerParamsSchema = discordWorkspaceParamsSchema.extend({
  guildId: z
    .string()
    .regex(/^\d{5,25}$/)
    .openapi({ param: { name: "guildId", in: "path", required: true } }),
})

export const discordPlaceAgentParamsSchema =
  discordWorkspaceParamsSchema.extend({
    channelId: z
      .string()
      .uuid()
      .openapi({ param: { name: "channelId", in: "path", required: true } }),
    agentId: z
      .string()
      .uuid()
      .openapi({ param: { name: "agentId", in: "path", required: true } }),
  })

const discordPlaceSchema = z.object({
  // The place's own id in Lor: what a Loop reports in.
  channelId: z.string().uuid(),
  discordChannelId: z.string(),
  name: z.string().nullable(),
  url: z.string(),
  // The agents in it, in the order they were added.
  agentIds: z.array(z.string().uuid()),
})

export const discordWorkspaceSchema = z.object({
  // Whether this Lor server has a Discord bot set up at all.
  available: z.boolean(),
  inviteUrl: z.string().nullable(),
  servers: z.array(
    z.object({
      guildId: z.string(),
      name: z.string().nullable(),
      connectedAt: z.string(),
      places: z.array(discordPlaceSchema),
    })
  ),
})

// A server's text channels, for picking one to put an agent in.
export const discordServerChannelsSchema = z.object({
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      // The agents already there, when it is a place.
      agentIds: z.array(z.string().uuid()),
    })
  ),
})

export const addDiscordPlaceAgentBodySchema = z.object({
  guildId: z.string().regex(/^\d{5,25}$/),
  discordChannelId: z.string().regex(/^\d{5,25}$/),
  agentId: z.string().uuid(),
})

export const addDiscordPlaceAgentResponseSchema = z.object({
  success: z.literal(true),
  channelId: z.string().uuid(),
})
