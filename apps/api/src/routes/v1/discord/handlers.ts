import { db, eq, schema } from "@repo/db"
import {
  discordChannelUrl,
  discordConfigured,
  discordInviteUrl,
  discordLinkFor,
} from "@repo/lor/discord"
import {
  createLinkCode,
  readConnectToken,
  unlinkDiscord,
} from "@/lib/discord/interactions"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { hasWorkspaceAuthority } from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ConnectDiscordAccountRoute,
  CreateChannelDiscordLinkCodeRoute,
  DisconnectDiscordAccountRoute,
  GetChannelDiscordRoute,
  GetDiscordAccountRoute,
  UnlinkChannelDiscordRoute,
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

export const createChannelDiscordLinkCode: AppRouteHandler<
  CreateChannelDiscordLinkCodeRoute
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
  if (!hasWorkspaceAuthority(c.var.authority, { channel: ["update"] })) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  if (!discordConfigured()) {
    return c.json(
      { success: false, message: "Discord isn't set up on this Lor server" },
      HttpStatusCodes.SERVICE_UNAVAILABLE
    )
  }
  const code = await createLinkCode({
    channelId,
    workspaceId: c.var.workspace.id,
    userId: c.var.user.id,
  })
  return c.json({ ...code, inviteUrl: discordInviteUrl() }, HttpStatusCodes.OK)
}

export const unlinkChannelDiscord: AppRouteHandler<
  UnlinkChannelDiscordRoute
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
  if (!hasWorkspaceAuthority(c.var.authority, { channel: ["update"] })) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  await unlinkDiscord(channelId)
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
        message: "This link is wrong or expired. Run /lor connect again.",
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
