import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  forbiddenSchema,
  notFoundSchema,
  serviceUnavailableSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  discordAccountSchema,
  discordChannelParamsSchema,
  discordConnectBodySchema,
  discordLinkCodeSchema,
  discordStatusSchema,
  discordSuccessSchema,
} from "@/routes/v1/discord/schema"

const channelPath = "/workspaces/{workspaceSlug}/channels/{channelId}/discord"

export const getChannelDiscord = createRoute({
  path: channelPath,
  method: "get",
  summary: "Where a channel's chat lives",
  description:
    "Whether the channel's chat is linked to a Discord channel (reference/always-on-agents.md §10).",
  tags: ["Discord"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: discordChannelParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discordStatusSchema,
      description: "The channel's Discord link",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const createChannelDiscordLinkCode = createRoute({
  path: `${channelPath}/link-code`,
  method: "post",
  summary: "Make a code to link a channel's chat to Discord",
  description:
    "A one-time code to run as `/lor link` in the Discord channel. Needs channel:update.",
  tags: ["Discord"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: discordChannelParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discordLinkCodeSchema,
      description: "The link code",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.SERVICE_UNAVAILABLE]: serviceUnavailableSchema,
  },
})

export const unlinkChannelDiscord = createRoute({
  path: channelPath,
  method: "delete",
  summary: "Move a channel's chat back to Lor",
  description:
    "Removes the Discord link and its webhook. Needs channel:update.",
  tags: ["Discord"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: discordChannelParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discordSuccessSchema,
      description: "Unlinked",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const getDiscordAccount = createRoute({
  path: "/discord/account",
  method: "get",
  summary: "Your linked Discord account",
  tags: ["Discord"],
  middleware: [sessionAuthMiddleware] as const,
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discordAccountSchema,
      description: "Your Discord account, if linked",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  },
})

export const connectDiscordAccount = createRoute({
  path: "/discord/connect",
  method: "post",
  summary: "Link your Discord account",
  description: "Finishes `/lor connect` with the token from its link.",
  tags: ["Discord"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    body: jsonContent({
      schema: discordConnectBodySchema,
      description: "The token from the link",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discordAccountSchema,
      description: "Your linked Discord account",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  },
})

export const disconnectDiscordAccount = createRoute({
  path: "/discord/account",
  method: "delete",
  summary: "Unlink your Discord account",
  tags: ["Discord"],
  middleware: [sessionAuthMiddleware] as const,
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discordSuccessSchema,
      description: "Unlinked",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  },
})

export type GetChannelDiscordRoute = typeof getChannelDiscord
export type CreateChannelDiscordLinkCodeRoute =
  typeof createChannelDiscordLinkCode
export type UnlinkChannelDiscordRoute = typeof unlinkChannelDiscord
export type GetDiscordAccountRoute = typeof getDiscordAccount
export type ConnectDiscordAccountRoute = typeof connectDiscordAccount
export type DisconnectDiscordAccountRoute = typeof disconnectDiscordAccount
