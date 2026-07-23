import { and, db, eq, gt, isNull, lte, or, schema } from "@repo/db"
import { type ServerToClientEvents, userRoom } from "@repo/realtime-types"
import { Emitter } from "@socket.io/redis-emitter"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { getRedisClient } from "@/lib/redis"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ListChannelMutesRoute,
  MuteChannelRoute,
  UnmuteChannelRoute,
} from "@/routes/v1/channel-mutes/routes"

let emitter: Emitter<ServerToClientEvents> | null = null

async function getEmitter() {
  const redis = await getRedisClient()
  if (!emitter) {
    emitter = new Emitter<ServerToClientEvents>(redis)
  }
  return emitter
}

// Best-effort cross-device sync — the DB row already changed, so a realtime
// delivery failure must not fail the mutation.
async function emitMuteUpdated(
  userId: string,
  payload: { channelId: string; mutedUntil: string | null; muted: boolean }
) {
  try {
    const io = await getEmitter()
    io.to(userRoom(userId)).emit("channel-mute:updated", payload)
  } catch (err) {
    logger.error({ err, userId }, "channel-mute:updated emit failed")
  }
}

export const listChannelMutes: AppRouteHandler<ListChannelMutesRoute> = async (
  c
) => {
  const currentUser = c.var.user

  // Lazy cleanup: expired mutes are dead rows. The select below already
  // excludes them, so pruning can run without delaying the response.
  void db
    .delete(schema.channelMute)
    .where(
      and(
        eq(schema.channelMute.userId, currentUser.id),
        lte(schema.channelMute.mutedUntil, new Date())
      )
    )
    .catch((err) => {
      logger.error({ err }, "Expired channel-mute prune failed")
    })

  const rows = await db
    .select({
      channelId: schema.channelMute.channelId,
      mutedUntil: schema.channelMute.mutedUntil,
    })
    .from(schema.channelMute)
    .where(
      and(
        eq(schema.channelMute.userId, currentUser.id),
        or(
          isNull(schema.channelMute.mutedUntil),
          gt(schema.channelMute.mutedUntil, new Date())
        )
      )
    )

  return c.json(
    {
      mutes: rows.map((row) => ({
        channelId: row.channelId,
        mutedUntil: row.mutedUntil?.toISOString() ?? null,
      })),
    },
    HttpStatusCodes.OK
  )
}

export const muteChannel: AppRouteHandler<MuteChannelRoute> = async (c) => {
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")
  const { until } = c.req.valid("json")

  const canAccess = await userCanAccessChannel(channelId, currentUser.id)
  if (!canAccess) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const mutedUntil = until ? new Date(until) : null
  await db
    .insert(schema.channelMute)
    .values({
      channelId,
      userId: currentUser.id,
      mutedUntil,
    })
    .onConflictDoUpdate({
      target: [schema.channelMute.channelId, schema.channelMute.userId],
      set: { mutedUntil },
    })

  const payload = {
    channelId,
    mutedUntil: mutedUntil?.toISOString() ?? null,
    muted: true,
  }
  await emitMuteUpdated(currentUser.id, payload)

  return c.json(
    {
      success: true as const,
      mute: { channelId, mutedUntil: payload.mutedUntil },
    },
    HttpStatusCodes.OK
  )
}

export const unmuteChannel: AppRouteHandler<UnmuteChannelRoute> = async (c) => {
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")

  await db
    .delete(schema.channelMute)
    .where(
      and(
        eq(schema.channelMute.channelId, channelId),
        eq(schema.channelMute.userId, currentUser.id)
      )
    )

  await emitMuteUpdated(currentUser.id, {
    channelId,
    mutedUntil: null,
    muted: false,
  })

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
