import { and, db, desc, eq, schema } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import { nextLoopRunAt, validateLoopSchedule } from "@repo/merlin/loop-schedule"
import { toRealtimeLoop } from "@repo/merlin/loops"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { emitLoopUpdated } from "@/lib/loops"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ActivateLoopRoute,
  ListChannelLoopsRoute,
} from "@/routes/v1/loops/routes"

const DAY_MS = 86_400_000

export const listChannelLoops: AppRouteHandler<ListChannelLoopsRoute> = async (
  c
) => {
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")

  const access = await resolveChannelAccess(currentUser.id, channelId)
  if (!access.ok) {
    return c.json(
      { success: false as const, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const loops = await db
    .select()
    .from(schema.loop)
    .where(eq(schema.loop.channelId, channelId))
    .orderBy(desc(schema.loop.createdAt))
    .limit(50)

  return c.json({ loops: loops.map(toRealtimeLoop) }, HttpStatusCodes.OK)
}

export const activateLoop: AppRouteHandler<ActivateLoopRoute> = async (c) => {
  const currentUser = c.var.user
  const { loopId } = c.req.valid("param")
  const { timezone, confirmHighFrequency } = c.req.valid("json")

  const loop = await db
    .select()
    .from(schema.loop)
    .where(eq(schema.loop.id, loopId))
    .limit(1)
    .then((rows) => rows[0])
  if (!loop) {
    return c.json(
      { success: false as const, message: "Loop not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const access = await resolveChannelAccess(currentUser.id, loop.channelId)
  if (!access.ok) {
    return c.json(
      { success: false as const, message: "Loop not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  // An active loop posts into the channel; archived channels can't take
  // writes, so refuse rather than activating into a dead end.
  if (!access.access.canWrite) {
    return c.json(
      { success: false as const, message: "Channel is archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (loop.status !== "draft") {
    return c.json(
      { success: false as const, message: "Loop is not a draft" },
      HttpStatusCodes.CONFLICT
    )
  }

  // Re-validate with the tz being pinned — the draft was gap-checked in UTC.
  const validation = validateLoopSchedule(loop.schedule, timezone)
  if (!validation.ok) {
    return c.json(
      { success: false as const, message: validation.reason },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (validation.requiresConfirmation && !confirmHighFrequency) {
    const firesPerDay = Math.max(1, Math.round(DAY_MS / validation.minGapMs))
    return c.json(
      {
        success: false as const,
        code: "requires_confirmation" as const,
        message: `This loop runs up to ${firesPerDay} times a day`,
        firesPerDay,
      },
      HttpStatusCodes.UNPROCESSABLE_ENTITY
    )
  }
  const next = nextLoopRunAt(loop.schedule, timezone)
  if (!next) {
    return c.json(
      { success: false as const, message: "Schedule has no future fires" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // CAS on draft status: a concurrent activation loses the predicate and
  // reads as already handled.
  const activated = await db
    .update(schema.loop)
    .set({
      status: "active",
      timezone,
      nextRunAt: next,
      pausedReason: null,
      consecutiveFailures: 0,
      ...(validation.requiresConfirmation
        ? {
            highFrequencyConfirmedAt: new Date(),
            highFrequencyConfirmedBy: currentUser.id,
          }
        : {}),
    })
    .where(and(eq(schema.loop.id, loopId), eq(schema.loop.status, "draft")))
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!activated) {
    return c.json(
      { success: false as const, message: "Loop is not a draft" },
      HttpStatusCodes.CONFLICT
    )
  }

  // Best-effort: the activation is durable; a socket emit failure only
  // delays the card flip until the next fetch.
  await emitLoopUpdated(activated).catch((err) =>
    logger.error({ err, loopId }, "Loop activation emit failed")
  )

  return c.json({ loop: toRealtimeLoop(activated) }, HttpStatusCodes.OK)
}
