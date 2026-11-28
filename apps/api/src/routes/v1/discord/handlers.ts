import { asc, db, eq, schema } from "@repo/db"
import {
  discordChannelUrl,
  discordConfigured,
  discordInviteUrl,
  discordLinkFor,
  discordRequest,
  LINKABLE_CHANNEL_TYPES,
} from "@repo/lor/discord"
import { createLinkCode, readConnectToken } from "@/lib/discord/interactions"
import {
  addAgentToDiscordChannel,
  disconnectDiscordGuild,
  discordGuildFor,
  listDiscordPlaces,
  removeAgentFromDiscordPlace,
} from "@/lib/discord/places"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { hasWorkspaceAuthority } from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  AddDiscordPlaceAgentRoute,
  ConnectDiscordAccountRoute,
  CreateDiscordLinkCodeRoute,
  DisconnectDiscordAccountRoute,
  DisconnectDiscordServerRoute,
  GetChannelDiscordRoute,
  GetDiscordAccountRoute,
  GetWorkspaceDiscordRoute,
  ListDiscordServerChannelsRoute,
  RemoveDiscordPlaceAgentRoute,
} from "@/routes/v1/discord/routes"

async function textChannelIn(workspaceId: string, channelId: string) {
  const [channel] = await db
    .select({
      type: schema.channel.type,
      workspaceId: schema.channel.workspaceId,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
  return channel?.type === "text" && channel.workspaceId === workspaceId
}

export const getChannelDiscord: AppRouteHandler<
  GetChannelDiscordRoute
> = async (c) => {
  const { channelId } = c.req.valid("param")
  if (
    !(await textChannelIn(c.var.workspace.id, channelId)) ||
    !(await userCanAccessChannel(channelId, c.var.user.id))
  ) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const link = await discordLinkFor(channelId)
  return c.json(
    {
      available: discordConfigured(),
      inviteUrl: discordInviteUrl(),
      link: link
        ? {
            guildName: link.guildName,
            channelName: link.discordChannelName,
            url: discordChannelUrl(link.guildId, link.discordChannelId),
            linkedAt: link.createdAt.toISOString(),
          }
        : null,
    },
    HttpStatusCodes.OK
  )
}

const forbidden = { success: false as const, message: "Forbidden" }
const notSetUp = {
  success: false as const,
  message: "Discord isn't set up on this Lor server",
}

// Who manages channels sees every place; anyone else only the places they
// can open (a private Discord channel's place is for its members).
async function visiblePlaces(
  workspaceId: string,
  userId: string,
  manager: boolean
) {
  const places = await listDiscordPlaces(workspaceId)
  if (manager) return places
  const visible = await Promise.all(
    places.map((place) => userCanAccessChannel(place.channelId, userId))
  )
  return places.filter((_, index) => visible[index])
}

export const getWorkspaceDiscord: AppRouteHandler<
  GetWorkspaceDiscordRoute
> = async (c) => {
  const workspaceId = c.var.workspace.id
  const manager = hasWorkspaceAuthority(c.var.authority, {
    channel: ["update"],
  })
  const [guilds, places] = await Promise.all([
    db
      .select()
      .from(schema.discordGuild)
      .where(eq(schema.discordGuild.workspaceId, workspaceId))
      .orderBy(asc(schema.discordGuild.createdAt)),
    visiblePlaces(workspaceId, c.var.user.id, manager),
  ])
  return c.json(
    {
      available: discordConfigured(),
      inviteUrl: discordInviteUrl(),
      servers: guilds.map((guild) => ({
        guildId: guild.guildId,
        name: guild.name,
        connectedAt: guild.createdAt.toISOString(),
        places: places
          .filter((place) => place.guildId === guild.guildId)
          .map(({ guildId: _guildId, ...place }) => place),
      })),
    },
    HttpStatusCodes.OK
  )
}

export const createDiscordLinkCode: AppRouteHandler<
  CreateDiscordLinkCodeRoute
> = async (c) => {
  if (!hasWorkspaceAuthority(c.var.authority, { channel: ["update"] })) {
    return c.json(forbidden, HttpStatusCodes.FORBIDDEN)
  }
  if (!discordConfigured()) {
    return c.json(notSetUp, HttpStatusCodes.SERVICE_UNAVAILABLE)
  }
  const code = await createLinkCode({
    workspaceId: c.var.workspace.id,
    userId: c.var.user.id,
  })
  return c.json({ ...code, inviteUrl: discordInviteUrl() }, HttpStatusCodes.OK)
}

export const disconnectDiscordServer: AppRouteHandler<
  DisconnectDiscordServerRoute
> = async (c) => {
  if (!hasWorkspaceAuthority(c.var.authority, { channel: ["update"] })) {
    return c.json(forbidden, HttpStatusCodes.FORBIDDEN)
  }
  const gone = await disconnectDiscordGuild(
    c.var.workspace.id,
    c.req.valid("param").guildId
  )
  if (!gone) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const listDiscordServerChannels: AppRouteHandler<
  ListDiscordServerChannelsRoute
> = async (c) => {
  const { guildId } = c.req.valid("param")
  const guild = await discordGuildFor(guildId)
  if (!guild || guild.workspaceId !== c.var.workspace.id) {
    return c.json(
      { success: false, message: "Server not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (!discordConfigured()) {
    return c.json(notSetUp, HttpStatusCodes.SERVICE_UNAVAILABLE)
  }
  const manager = hasWorkspaceAuthority(c.var.authority, {
    channel: ["update"],
  })
  const [channels, places] = await Promise.all([
    discordRequest<
      Array<{ id: string; name: string; type: number; position?: number }>
    >(`/guilds/${guildId}/channels`),
    visiblePlaces(c.var.workspace.id, c.var.user.id, manager),
  ])
  const agentsIn = new Map(
    places.map((place) => [place.discordChannelId, place.agentIds])
  )
  return c.json(
    {
      // Managers pick from every channel; anyone else sees only the places
      // they can open, read-only.
      channels: channels
        .filter((channel) => LINKABLE_CHANNEL_TYPES.has(channel.type))
        .filter((channel) => manager || agentsIn.has(channel.id))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          agentIds: agentsIn.get(channel.id) ?? [],
        })),
    },
    HttpStatusCodes.OK
  )
}

export const addDiscordPlaceAgent: AppRouteHandler<
  AddDiscordPlaceAgentRoute
> = async (c) => {
  if (!hasWorkspaceAuthority(c.var.authority, { channel: ["update"] })) {
    return c.json(forbidden, HttpStatusCodes.FORBIDDEN)
  }
  const added = await addAgentToDiscordChannel({
    ...c.req.valid("json"),
    workspaceId: c.var.workspace.id,
    userId: c.var.user.id,
  })
  if (added.ok) {
    return c.json(
      { success: true as const, channelId: added.channelId },
      HttpStatusCodes.OK
    )
  }
  if (added.reason === "no_server" || added.reason === "no_agent") {
    return c.json(
      {
        success: false,
        message:
          added.reason === "no_server" ? "Server not found" : "Agent not found",
      },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json(
    {
      success: false,
      message: {
        not_a_text_channel: "Pick a text channel, not a thread or forum",
        already_here: "That agent is already in this channel",
        too_many: "This channel has as many agents as one can hold",
        discord_refused: `Discord didn't allow it: ${added.detail ?? "unknown error"}. Check that Lor can manage webhooks in that channel.`,
      }[added.reason],
    },
    HttpStatusCodes.BAD_REQUEST
  )
}

export const removeDiscordPlaceAgent: AppRouteHandler<
  RemoveDiscordPlaceAgentRoute
> = async (c) => {
  if (!hasWorkspaceAuthority(c.var.authority, { channel: ["update"] })) {
    return c.json(forbidden, HttpStatusCodes.FORBIDDEN)
  }
  const { channelId, agentId } = c.req.valid("param")
  const removed = await removeAgentFromDiscordPlace({
    workspaceId: c.var.workspace.id,
    channelId,
    agentId,
    userId: c.var.user.id,
  })
  if (!removed) {
    return c.json(
      { success: false, message: "That agent is not in this place" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

async function accountOf(userId: string) {
  const [account] = await db
    .select({ username: schema.discordAccount.username })
    .from(schema.discordAccount)
    .where(eq(schema.discordAccount.userId, userId))
  return account ?? null
}

export const getDiscordAccount: AppRouteHandler<
  GetDiscordAccountRoute
> = async (c) =>
  c.json({ account: await accountOf(c.var.user.id) }, HttpStatusCodes.OK)

export const connectDiscordAccount: AppRouteHandler<
  ConnectDiscordAccountRoute
> = async (c) => {
  const data = readConnectToken(c.req.valid("json").token)
  if (!data) {
    return c.json(
      {
        success: false,
        message:
          "This link is wrong or expired. Run /lor connect-account again.",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  // One Lor account per Discord account: linking moves it.
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.discordAccount)
      .where(eq(schema.discordAccount.discordUserId, data.discordUserId))
    await tx
      .insert(schema.discordAccount)
      .values({
        userId: c.var.user.id,
        discordUserId: data.discordUserId,
        username: data.username,
      })
      .onConflictDoUpdate({
        target: schema.discordAccount.userId,
        set: { discordUserId: data.discordUserId, username: data.username },
      })
  })
  return c.json({ account: { username: data.username } }, HttpStatusCodes.OK)
}

export const disconnectDiscordAccount: AppRouteHandler<
  DisconnectDiscordAccountRoute
> = async (c) => {
  await db
    .delete(schema.discordAccount)
    .where(eq(schema.discordAccount.userId, c.var.user.id))
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
