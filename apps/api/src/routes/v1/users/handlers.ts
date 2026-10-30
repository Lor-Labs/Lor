import { and, db, eq, inArray, isNull, schema } from "@repo/db"
import { PRESENCE_ONLINE_USERS_SET_KEY } from "@repo/realtime-types"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { getRedisClient } from "@/lib/redis"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type { GetUserProfileRoute } from "@/routes/v1/users/routes"

// Profiles and presence are visible only to people who share a workspace or
// a DM with the user.
async function canViewProfile(viewerId: string, targetId: string) {
  if (viewerId === targetId) return true
  const [sharedWorkspace, sharedChannel] = await Promise.all([
    db
      .select({ id: schema.workspaceMember.id })
      .from(schema.workspaceMember)
      .where(
        and(
          eq(schema.workspaceMember.userId, targetId),
          inArray(
            schema.workspaceMember.workspaceId,
            db
              .select({ id: schema.workspaceMember.workspaceId })
              .from(schema.workspaceMember)
              .where(eq(schema.workspaceMember.userId, viewerId))
          )
        )
      )
      .limit(1),
    // DMs and group DMs only (workspaceId null): workspace channels keep
    // channel_member rows after a kick, so they don't count.
    db
      .select({ id: schema.channelMember.id })
      .from(schema.channelMember)
      .innerJoin(
        schema.channel,
        eq(schema.channel.id, schema.channelMember.channelId)
      )
      .where(
        and(
          isNull(schema.channel.workspaceId),
          eq(schema.channelMember.userId, targetId),
          inArray(
            schema.channelMember.channelId,
            db
              .select({ id: schema.channelMember.channelId })
              .from(schema.channelMember)
              .where(eq(schema.channelMember.userId, viewerId))
          )
        )
      )
      .limit(1),
  ])
  return sharedWorkspace.length > 0 || sharedChannel.length > 0
}

export const getUserProfile: AppRouteHandler<GetUserProfileRoute> = async (
  c
) => {
  const { userId } = c.req.valid("param")

  if (!(await canViewProfile(c.var.user.id, userId))) {
    return c.json(
      { success: false, message: "User not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const targetUser = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
      bio: schema.user.bio,
      status: schema.user.status,
      createdAt: schema.user.createdAt,
      isBot: schema.user.isBot,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
    .then((rows) => rows[0])

  if (!targetUser) {
    return c.json(
      { success: false, message: "User not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // Check online status. Bots (Lor) have no socket presence — always online.
  let presenceStatus: "online" | "offline" = "offline"
  if (targetUser.isBot) {
    presenceStatus = "online"
  } else {
    try {
      const redis = await getRedisClient()
      const [isOnline] = await redis.smIsMember(PRESENCE_ONLINE_USERS_SET_KEY, [
        userId,
      ])
      if (isOnline) presenceStatus = "online"
    } catch {
      // fail open — default to offline
    }
  }

  return c.json(
    {
      success: true,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        image: targetUser.image,
        bio: targetUser.bio ?? null,
        status: targetUser.status ?? null,
        createdAt: targetUser.createdAt.toISOString(),
        presenceStatus,
        isBot: targetUser.isBot,
      },
    },
    HttpStatusCodes.OK
  )
}
