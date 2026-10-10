import {
  and,
  db,
  eq,
  inArray,
  isNull,
  isUniqueViolation,
  LOR_USER_ID,
  schema,
  sql,
} from "@repo/db"
import { subscribeToThread } from "@repo/db/queries/thread-subscriptions"
import type { Loop } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { ensureLoopSession } from "@repo/lor/agent-sessions"
import { nextLoopRunAt, validateLoopSchedule } from "@repo/lor/loop-schedule"
import { toRealtimeLoop } from "@repo/lor/loops"
import {
  AGENT_RUN_STOP_CHANNEL,
  LOOP_RUN_JOB,
  LOOP_RUN_QUEUE,
  type LoopRunJobData,
} from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import { Queue } from "bullmq"
import { getEmitter } from "@/lib/bot-messages"
import { postLoopChannelEvent } from "@/lib/channel-events"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

// Loop lifecycle transitions shared by the L2 activate flow and L3
// management routes. All emits go to the channel room (channel membership
// already implies loop visibility). See reference/loops.md.

export async function emitLoopUpdated(row: Loop): Promise<void> {
  const emitter = await getEmitter()
  emitter
    .to(channelRoom(row.channelId))
    .emit("loop:updated", { loop: toRealtimeLoop(row) })
}

function parseRedisUrl(url: string) {
  const parsed = new URL(url)
  const dbIndex = Number.parseInt(parsed.pathname.slice(1), 10)
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    db: Number.isFinite(dbIndex) ? dbIndex : 0,
  }
}

let loopRunQueue: Queue<LoopRunJobData> | null = null
function getLoopRunQueue(): Queue<LoopRunJobData> {
  loopRunQueue ??= new Queue<LoopRunJobData>(LOOP_RUN_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400, count: 5000 },
    },
  })
  return loopRunQueue
}

// At activation the loop's session exists right away: the session its draft
// card sits in, or a new one. The creator and the person who activated it
// follow it, so it is in their sidebars before the first run.
export async function openLoopSession(
  loop: Loop,
  activatorId: string
): Promise<void> {
  await adoptCardSession(loop)
  const session = await ensureLoopSession(loop)
  await subscribeToThread(session.threadRootId, [
    activatorId,
    ...(loop.creatorId ? [loop.creatorId] : []),
  ])
  notifyWorkspaceActivity(loop.workspaceId)
}

// The session a loop's draft card sits in becomes the loop's session, so
// every fire lands in the conversation where it was set up instead of a new
// one. A session holds at most one loop; another loop set up there gets its
// own session.
async function adoptCardSession(loop: Loop): Promise<void> {
  if (!loop.cardMessageId) return
  const card = await db
    .select({ threadRootId: schema.message.threadRootId })
    .from(schema.message)
    .where(eq(schema.message.id, loop.cardMessageId))
    .limit(1)
    .then((rows) => rows[0])
  if (!card?.threadRootId) return
  await db
    .update(schema.agentSession)
    .set({ loopId: loop.id })
    .where(
      and(
        eq(schema.agentSession.threadRootId, card.threadRootId),
        eq(schema.agentSession.channelId, loop.channelId),
        isNull(schema.agentSession.loopId)
      )
    )
    .catch((err) => {
      // The loop already has a session (agent_session_loopId_uidx).
      if (!isUniqueViolation(err)) throw err
    })
}

// Manual "Run now" from the loop panel: the same fire job the sweep queues
// (a turn in the loop's session), but the cadence is untouched — nextRunAt
// stays where the schedule put it. A fire still running refuses another.
export async function runLoopNow(input: {
  loopId: string
}): Promise<
  | { ok: true; loop: Loop }
  | { ok: false; reason: "not_active" | "already_running" | "enqueue_failed" }
> {
  const loop = await db
    .select()
    .from(schema.loop)
    .where(eq(schema.loop.id, input.loopId))
    .then((rows) => rows[0] ?? null)
  if (!loop || loop.status !== "active")
    return { ok: false, reason: "not_active" }

  const running = await db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.loopId, loop.id),
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (running) return { ok: false, reason: "already_running" }

  const firedAt = new Date()
  try {
    await getLoopRunQueue().add(
      LOOP_RUN_JOB,
      { loopId: loop.id, scheduledFor: firedAt.toISOString() },
      {
        jobId: `${loop.id}-now-${firedAt.getTime()}`,
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
        removeOnComplete: true,
      }
    )
  } catch (err) {
    logger.error({ err, loopId: loop.id }, "Run-now enqueue failed")
    return { ok: false, reason: "enqueue_failed" }
  }

  // lastRunAt means "last fired" — manual fires count. The emit also nudges
  // clients to refresh the run history.
  const updated = await db
    .update(schema.loop)
    .set({ lastRunAt: new Date() })
    .where(eq(schema.loop.id, loop.id))
    .returning()
    .then((rows) => rows[0] ?? loop)
  await emitLoopUpdated(updated)
  return { ok: true, loop: updated }
}

// A run already inside respond() needs the durable stop flag + the fast-path
// publish, same as a user stop — shared by pause and manual complete.
async function stopInFlightRuns(
  loopId: string,
  requestedBy?: string
): Promise<void> {
  const inFlight = await db
    .update(schema.agentRun)
    .set({
      stopRequestedAt: sql`coalesce(${schema.agentRun.stopRequestedAt}, now())`,
      stopRequestedBy: requestedBy ?? null,
    })
    .where(
      and(
        eq(schema.agentRun.loopId, loopId),
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
      )
    )
    .returning({ id: schema.agentRun.id })
    .catch((err) => {
      logger.error({ err, loopId }, "Loop stop: in-flight stop flag failed")
      return [] as { id: string }[]
    })
  for (const run of inFlight) {
    // Fast path: best-effort — the flag above is the durable fallback.
    await getRedisClient()
      .then((redis) => redis.publish(AGENT_RUN_STOP_CHANNEL, run.id))
      .catch(() => {})
  }
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

  await stopInFlightRuns(input.loopId, input.requestedBy)

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
      endAt: schema.loop.endAt,
    })
    .from(schema.loop)
    .where(eq(schema.loop.id, input.loopId))
    .then((rows) => rows[0])
  if (!loop || loop.status !== "paused") return null
  // Paused loops were active once, so a tz was pinned at activation; a null
  // here is a broken row, not a resumable loop.
  if (!loop.timezone) return { ok: false, reason: "Loop has no timezone" }
  if (loop.endAt && loop.endAt.getTime() <= Date.now()) {
    return { ok: false, reason: "This loop's end date has passed" }
  }

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

// Manual completion (the human calling it done, vs the model's complete_loop
// tool). Terminal: clears scheduling and stops anything in flight. CAS over
// active|paused so a racing tool-completion or double click reads as a no-op.
export async function completeLoopManually(input: {
  loopId: string
  requestedBy?: string
}): Promise<Loop | null> {
  const completed = await db
    .update(schema.loop)
    .set({
      status: "completed",
      pausedReason: null,
      nextRunAt: null,
      completedNote: "Marked completed by the team",
    })
    .where(
      and(
        eq(schema.loop.id, input.loopId),
        inArray(schema.loop.status, ["active", "paused"])
      )
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!completed) return null

  await stopInFlightRuns(input.loopId, input.requestedBy)

  await emitLoopUpdated(completed)
  await postLoopChannelEvent({
    loop: completed,
    actorId: input.requestedBy ?? LOR_USER_ID,
    eventType: "loop_completed",
  })
  return completed
}

// Finish removing a loop after its row is gone: the card is the loop's chat
// representation, so leaving it behind would render a stale fallback forever.
// Run rows survive (agent_run.loopId nulls via FK) for audit.
async function deleteLoopCardAndEmit(loop: Loop): Promise<void> {
  const emitter = await getEmitter().catch(() => null)
  if (loop.cardMessageId) {
    // Only announce the deletion if it actually happened: telling clients to
    // drop a row that is still in the table makes it reappear on the next
    // fetch, which reads as the card resurrecting itself.
    const cardDeleted = await db
      .delete(schema.message)
      .where(eq(schema.message.id, loop.cardMessageId))
      .then(() => true)
      .catch((err) => {
        logger.error(
          { err, loopId: loop.id },
          "Loop delete: card message delete failed"
        )
        return false
      })
    if (cardDeleted) {
      emitter?.to(channelRoom(loop.channelId)).emit("message:deleted", {
        channelId: loop.channelId,
        messageId: loop.cardMessageId,
      })
    }
  }
  emitter?.to(channelRoom(loop.channelId)).emit("loop:deleted", {
    loopId: loop.id,
    channelId: loop.channelId,
  })
}

// Cancel the conversational creation flow. The status predicate is the safety
// boundary: if another teammate activated the proposal first, this loses the
// race instead of deleting a newly-live schedule.
export async function discardDraftLoop(loopId: string): Promise<Loop | null> {
  const discarded = await db
    .delete(schema.loop)
    .where(and(eq(schema.loop.id, loopId), eq(schema.loop.status, "draft")))
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!discarded) return null

  await deleteLoopCardAndEmit(discarded)
  return discarded
}

// Hard delete: the loop row AND its card message. In-flight runs get the same
// stop treatment as pause.
export async function deleteLoop(input: {
  loop: Loop
  requestedBy?: string
}): Promise<void> {
  await stopInFlightRuns(input.loop.id, input.requestedBy)
  await db.delete(schema.loop).where(eq(schema.loop.id, input.loop.id))
  await deleteLoopCardAndEmit(input.loop)
}

// Project-archive invariant: a loop can't outlive its project — archived
// channels refuse writes, so the runs would just fail into auto-pause.
// Completes every live loop in the given channels (drafts stay: they're
// inert, and activation refuses archived channels anyway).
export async function completeLoopsForChannels(
  channelIds: string[],
  note: string
): Promise<void> {
  if (channelIds.length === 0) return
  const completed = await db
    .update(schema.loop)
    .set({
      status: "completed",
      completedNote: note,
      pausedReason: null,
      nextRunAt: null,
    })
    .where(
      and(
        inArray(schema.loop.channelId, channelIds),
        inArray(schema.loop.status, ["active", "paused"])
      )
    )
    .returning()
    .catch((err) => {
      logger.error({ err, channelIds }, "Project loop completion failed")
      return [] as Loop[]
    })
  for (const loop of completed) {
    await stopInFlightRuns(loop.id)
    await emitLoopUpdated(loop).catch(() => {})
  }
}
