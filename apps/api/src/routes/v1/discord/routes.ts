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
  addDiscordPlaceAgentBodySchema,
  addDiscordPlaceAgentResponseSchema,
  discordAccountSchema,
  discordChannelParamsSchema,
  discordConnectBodySchema,
  discordLinkCodeSchema,
  discordPlaceAgentParamsSchema,
  discordServerChannelsSchema,
  discordServerParamsSchema,
  discordStatusSchema,
  discordSuccessSchema,
  discordWorkspaceParamsSchema,
  discordWorkspaceSchema,
} from "@/routes/v1/discord/schema"

const channelPath = "/workspaces/{workspaceSlug}/channels/{channelId}/discord"

export const getChannelDiscord = createRoute({
  path: channelPath,
  method: "get",
  summary: "Whether a channel is a place in Discord",
  description:
    "The Discord channel behind a place: its messages are read-only in Lor (reference/agents-and-chats.md, decision 51).",
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

const workspacePath = "/workspaces/{workspaceSlug}/discord"

export const getWorkspaceDiscord = createRoute({
  path: workspacePath,
  method: "get",
  summary: "A workspace's Discord servers and places",
  description:
    "The Discord servers connected to the workspace and the channels of each that agents are in (reference/agents-and-chats.md, decision 51).",
  tags: ["Discord"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: discordWorkspaceParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discordWorkspaceSchema,
      description: "Servers and places",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const createDiscordLinkCode = createRoute({
  path: `${workspacePath}/link-code`,
  method: "post",
  summary: "Make a code to connect a Discord server",
  description:
    "A one-time code to run as `/lor link` in the Discord server. Needs channel:update.",
  tags: ["Discord"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: discordWorkspaceParamsSchema },
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

export const disconnectDiscordServer = createRoute({
  path: `${workspacePath}/servers/{guildId}`,
  method: "delete",
  summary: "Disconnect a Discord server",
  description:
    "Removes every place in the server and has the bot leave it. Needs channel:update.",
  tags: ["Discord"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: discordServerParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discordSuccessSchema,
      description: "Disconnected",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const listDiscordServerChannels = createRoute({
  path: `${workspacePath}/servers/{guildId}/channels`,
  method: "get",
  summary: "A connected server's text channels",
  description: "The channels an agent can be put in, with the agents in each.",
  tags: ["Discord"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: discordServerParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discordServerChannelsSchema,
      description: "The server's text channels",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.SERVICE_UNAVAILABLE]: serviceUnavailableSchema,
  },
})

export const addDiscordPlaceAgent = createRoute({
  path: `${workspacePath}/places`,
  method: "post",
  summary: "Put an agent in a Discord channel",
  description:
    "Makes the channel a place when it is not one yet. Needs channel:update.",
  tags: ["Discord"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: discordWorkspaceParamsSchema,
    body: jsonContent({
      schema: addDiscordPlaceAgentBodySchema,
      description: "The agent and the Discord channel",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: addDiscordPlaceAgentResponseSchema,
      description: "The place the agent is in now",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const removeDiscordPlaceAgent = createRoute({
  path: `${workspacePath}/places/{channelId}/agents/{agentId}`,
  method: "delete",
  summary: "Take an agent out of a place in Discord",
  description: "The place goes with its last agent. Needs channel:update.",
  tags: ["Discord"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: discordPlaceAgentParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: discordSuccessSchema,
      description: "Removed",
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
  description: "Finishes `/lor connect-account` with the token from its link.",
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
export type GetWorkspaceDiscordRoute = typeof getWorkspaceDiscord
export type CreateDiscordLinkCodeRoute = typeof createDiscordLinkCode
export type DisconnectDiscordServerRoute = typeof disconnectDiscordServer
export type ListDiscordServerChannelsRoute = typeof listDiscordServerChannels
export type AddDiscordPlaceAgentRoute = typeof addDiscordPlaceAgent
export type RemoveDiscordPlaceAgentRoute = typeof removeDiscordPlaceAgent
export type GetDiscordAccountRoute = typeof getDiscordAccount
export type ConnectDiscordAccountRoute = typeof connectDiscordAccount
export type DisconnectDiscordAccountRoute = typeof disconnectDiscordAccount
