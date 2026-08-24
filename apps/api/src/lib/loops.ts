import { and, db, eq, inArray, schema, sql } from "@repo/db"
import type { Loop } from "@repo/db/schema"
import { nextLoopRunAt, validateLoopSchedule } from "@repo/merlin/loop-schedule"
import { toRealtimeLoop } from "@repo/merlin/loops"
import { AGENT_RUN_STOP_CHANNEL } from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import { getEmitter } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"

// Loop lifecycle transitions shared by the L2 activate flow and L3
// management routes. All emits go to the channel room (channel membership
// already implies loop visibility). See reference/loops.md.

export async function emitLoopUpdated(row: Loop): Promise<void> {
  const emitter = await getEmitter()
  emitter
    .to(channelRoom(row.channelId))
    .emit("loop:updated", { loop: toRealtimeLoop(row) })
}

// Pause = kill switch + in-flight stop. The CAS cancels future ticks and the
// processor's re-read cancels queued runs; a run already inside respond()
// needs the durable stop flag + the fast-path publish, same as a user stop.
export async function pauseLoop(input: {
  loopId: string
  requestedBy?: string
}): Promise<Loop | null> {
  const paused = await db
    .update(schema.loop)
    .set({ status: "paused", pausedReason: "manual", nextRunAt: null })
    .where(
      and(eq(schema.loop.id, input.loopId), eq(schema.loop.status, "active"))
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!paused) return null

  const inFlight = await db
    .update(schema.agentRun)
    .set({
      stopRequestedAt: sql`coalesce(${schema.agentRun.stopRequestedAt}, now())`,
      stopRequestedBy: input.requestedBy ?? null,
    })
    .where(
      and(
        eq(schema.agentRun.scopeKey, input.loopId),
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
      )
    )
    .returning({ id: schema.agentRun.id })
    .catch((err) => {
      logger.error(
        { err, loopId: input.loopId },
        "Loop pause: in-flight stop flag failed"
      )
      return [] as { id: string }[]
    })
  for (const run of inFlight) {
    // Fast path: best-effort — the flag above is the durable fallback.
    await getRedisClient()
      .then((redis) => redis.publish(AGENT_RUN_STOP_CHANNEL, run.id))
      .catch(() => {})
  }

  await emitLoopUpdated(paused)
  return paused
}

export type ResumeLoopResult =
  | { ok: true; loop: Loop }
  | { ok: false; reason: string }

// Resume re-validates the schedule (it may have been edited or its timezone
// rules may have drifted) and restarts the failure counter — resuming is the
// human saying "try again", not "fail once more and re-pause".
export async function resumeLoop(input: {
  loopId: string
}): Promise<ResumeLoopResult | null> {
  const loop = await db
    .select({
      schedule: schema.loop.schedule,
      timezone: schema.loop.timezone,
      status: schema.loop.status,
    })
    .from(schema.loop)
    .where(eq(schema.loop.id, input.loopId))
    .then((rows) => rows[0])
  if (!loop || loop.status !== "paused") return null
  // Paused loops were active once, so a tz was pinned at activation; a null
  // here is a broken row, not a resumable loop.
  if (!loop.timezone) return { ok: false, reason: "Loop has no timezone" }

  const validation = validateLoopSchedule(loop.schedule, loop.timezone)
  if (!validation.ok) return { ok: false, reason: validation.reason }
  const next = nextLoopRunAt(loop.schedule, loop.timezone)
  if (!next) return { ok: false, reason: "Schedule has no future fires" }

  const resumed = await db
    .update(schema.loop)
    .set({
      status: "active",
      pausedReason: null,
      nextRunAt: next,
      consecutiveFailures: 0,
    })
    .where(
      and(eq(schema.loop.id, input.loopId), eq(schema.loop.status, "paused"))
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!resumed) return null

  await emitLoopUpdated(resumed)
  return { ok: true, loop: resumed }
}
