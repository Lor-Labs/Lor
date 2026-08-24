import { and, db, desc, eq, inArray, schema, sql } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import type { Loop } from "@repo/db/schema"
import { nextLoopRunAt, validateLoopSchedule } from "@repo/merlin/loop-schedule"
import { toRealtimeLoop } from "@repo/merlin/loops"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import {
  completeLoopManually,
  emitLoopUpdated,
  pauseLoop as pauseLoopAction,
  resumeLoop as resumeLoopAction,
} from "@/lib/loops"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { serializeArtifact } from "@/routes/v1/artifacts/handlers"
import type {
  ActivateLoopRoute,
  CompleteLoopRoute,
  ListChannelLoopsRoute,
  ListLoopRunsRoute,
  PauseLoopRoute,
  ResumeLoopRoute,
  UpdateLoopRoute,
} from "@/routes/v1/loops/routes"

const DAY_MS = 86_400_000

// Loop + the caller's channel access, denials collapsed to null (= 404,
// fail closed — a loop's existence reveals channel activity).
async function loadAccessibleLoop(
  loopId: string,
  userId: string
): Promise<{ loop: Loop; canWrite: boolean } | null> {
  const loop = await db
    .select()
    .from(schema.loop)
    .where(eq(schema.loop.id, loopId))
    .limit(1)
    .then((rows) => rows[0])
  if (!loop) return null
  const access = await resolveChannelAccess(userId, loop.channelId)
  if (!access.ok) return null
  return { loop, canWrite: access.access.canWrite }
}

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

  const found = await loadAccessibleLoop(loopId, currentUser.id)
  if (!found) {
    return c.json(
      { success: false as const, message: "Loop not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const { loop, canWrite } = found
  // An active loop posts into the channel; archived channels can't take
  // writes, so refuse rather than activating into a dead end.
  if (!canWrite) {
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

// Draft-only schedule edit from the panel's structured editor. Editing an
// active loop needs pause/recompute/re-confirm semantics — that's L3; the
// 409 here keeps the invariant "active schedules only change via resume".
export const updateLoop: AppRouteHandler<UpdateLoopRoute> = async (c) => {
  const currentUser = c.var.user
  const { loopId } = c.req.valid("param")
  const { schedule } = c.req.valid("json")

  const found = await loadAccessibleLoop(loopId, currentUser.id)
  if (!found) {
    return c.json(
      { success: false as const, message: "Loop not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const { loop } = found
  if (loop.status !== "draft") {
    return c.json(
      { success: false as const, message: "Only draft loops can be edited" },
      HttpStatusCodes.CONFLICT
    )
  }

  // Drafts may not have a tz pinned yet; the gap thresholds are
  // tz-insensitive, and activation re-validates with the pinned tz.
  const validation = validateLoopSchedule(schedule, loop.timezone ?? "UTC")
  if (!validation.ok) {
    return c.json(
      { success: false as const, message: validation.reason },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const updated = await db
    .update(schema.loop)
    .set({ schedule })
    .where(and(eq(schema.loop.id, loopId), eq(schema.loop.status, "draft")))
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!updated) {
    return c.json(
      { success: false as const, message: "Only draft loops can be edited" },
      HttpStatusCodes.CONFLICT
    )
  }

  await emitLoopUpdated(updated).catch((err) =>
    logger.error({ err, loopId }, "Loop update emit failed")
  )

  return c.json({ loop: toRealtimeLoop(updated) }, HttpStatusCodes.OK)
}

export const pauseLoop: AppRouteHandler<PauseLoopRoute> = async (c) => {
  const currentUser = c.var.user
  const { loopId } = c.req.valid("param")

  const found = await loadAccessibleLoop(loopId, currentUser.id)
  if (!found) {
    return c.json(
      { success: false as const, message: "Loop not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const paused = await pauseLoopAction({ loopId, requestedBy: currentUser.id })
  if (!paused) {
    return c.json(
      { success: false as const, message: "Loop is not active" },
      HttpStatusCodes.CONFLICT
    )
  }
  return c.json({ loop: toRealtimeLoop(paused) }, HttpStatusCodes.OK)
}

export const resumeLoop: AppRouteHandler<ResumeLoopRoute> = async (c) => {
  const currentUser = c.var.user
  const { loopId } = c.req.valid("param")

  const found = await loadAccessibleLoop(loopId, currentUser.id)
  if (!found) {
    return c.json(
      { success: false as const, message: "Loop not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  // Resuming restarts posting into the channel — refuse on archived, same
  // as activation.
  if (!found.canWrite) {
    return c.json(
      { success: false as const, message: "Channel is archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const result = await resumeLoopAction({ loopId })
  if (!result) {
    return c.json(
      { success: false as const, message: "Loop is not paused" },
      HttpStatusCodes.CONFLICT
    )
  }
  if (!result.ok) {
    return c.json(
      { success: false as const, message: result.reason },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  return c.json({ loop: toRealtimeLoop(result.loop) }, HttpStatusCodes.OK)
}

export const completeLoop: AppRouteHandler<CompleteLoopRoute> = async (c) => {
  const currentUser = c.var.user
  const { loopId } = c.req.valid("param")

  const found = await loadAccessibleLoop(loopId, currentUser.id)
  if (!found) {
    return c.json(
      { success: false as const, message: "Loop not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const completed = await completeLoopManually({
    loopId,
    requestedBy: currentUser.id,
  })
  if (!completed) {
    return c.json(
      { success: false as const, message: "Loop is not active or paused" },
      HttpStatusCodes.CONFLICT
    )
  }
  return c.json({ loop: toRealtimeLoop(completed) }, HttpStatusCodes.OK)
}

const RUN_HISTORY_LIMIT = 20

// Run history: newest scheduled fire first (scheduledFor is when the cron
// meant it to run; createdAt covers legacy/edge rows). Spawned tasks and
// artifacts hang off originRunId; effects are the recorded side-effect tools.
export const listLoopRuns: AppRouteHandler<ListLoopRunsRoute> = async (c) => {
  const currentUser = c.var.user
  const { loopId } = c.req.valid("param")

  const found = await loadAccessibleLoop(loopId, currentUser.id)
  if (!found) {
    return c.json(
      { success: false as const, message: "Loop not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const runs = await db
    .select({
      id: schema.agentRun.id,
      state: schema.agentRun.state,
      stopReason: schema.agentRun.stopReason,
      scheduledFor: schema.agentRun.scheduledFor,
      createdAt: schema.agentRun.createdAt,
      finishedAt: schema.agentRun.finishedAt,
      note: schema.agentRun.handoffNote,
      creditsSpent: schema.agentRun.creditsSpent,
    })
    .from(schema.agentRun)
    .where(eq(schema.agentRun.loopId, loopId))
    .orderBy(
      desc(
        sql`coalesce(${schema.agentRun.scheduledFor}, ${schema.agentRun.createdAt})`
      )
    )
    .limit(RUN_HISTORY_LIMIT)

  const runIds = runs.map((r) => r.id)
  const [tasks, artifacts, effects] =
    runIds.length > 0
      ? await Promise.all([
          db
            .select({
              id: schema.task.id,
              title: schema.task.title,
              status: schema.task.status,
              cardMessageId: schema.task.cardMessageId,
              originRunId: schema.task.originRunId,
            })
            .from(schema.task)
            .where(inArray(schema.task.originRunId, runIds)),
          db
            .select({
              artifact: schema.artifact,
              currentVersion: schema.artifactVersion,
            })
            .from(schema.artifact)
            .leftJoin(
              schema.artifactVersion,
              and(
                eq(schema.artifactVersion.artifactId, schema.artifact.id),
                eq(
                  schema.artifactVersion.version,
                  schema.artifact.currentVersion
                )
              )
            )
            .where(inArray(schema.artifact.originRunId, runIds)),
          db
            .selectDistinct({
              runId: schema.agentRunToolResult.runId,
              toolName: schema.agentRunToolResult.toolName,
            })
            .from(schema.agentRunToolResult)
            .where(inArray(schema.agentRunToolResult.runId, runIds)),
        ])
      : [[], [], []]

  const effectsByRun = new Map<string, string[]>()
  for (const row of effects) {
    const list = effectsByRun.get(row.runId) ?? []
    list.push(row.toolName)
    effectsByRun.set(row.runId, list)
  }

  return c.json(
    {
      runs: runs.map((run) => ({
        id: run.id,
        state: run.state,
        stopReason: run.stopReason,
        scheduledFor: run.scheduledFor ? run.scheduledFor.toISOString() : null,
        createdAt: run.createdAt.toISOString(),
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        note: run.note,
        creditsSpent: run.creditsSpent,
        effects: (effectsByRun.get(run.id) ?? []).sort(),
        tasks: tasks
          .filter((t) => t.originRunId === run.id)
          .map(({ originRunId: _originRunId, ...t }) => t),
        artifacts: artifacts
          .filter((a) => a.artifact.originRunId === run.id)
          .map((a) => serializeArtifact(a.artifact, a.currentVersion)),
      })),
    },
    HttpStatusCodes.OK
  )
}
