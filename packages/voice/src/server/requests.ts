import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  schema,
  sql,
} from "@repo/db"
import type {
  NewVoiceRequest,
  VoiceRequest,
  VoiceRequestCheck,
  VoiceRequestResult,
} from "@repo/db/schema"
import type { VoiceRequestState } from "@repo/realtime-types/events"

const { user, voiceRequest, voiceSession, voiceSessionParticipant } = schema

// A request someone can still cancel.
const ACTIVE_STATUSES = ["listening", "queued", "working"] as const

const stateColumns = {
  id: voiceRequest.id,
  sessionId: voiceRequest.sessionId,
  participantId: voiceRequest.participantId,
  userId: voiceRequest.userId,
  heardText: voiceRequest.heardText,
  status: voiceRequest.status,
  result: voiceRequest.result,
  dismissedAt: voiceRequest.dismissedAt,
  createdAt: voiceRequest.createdAt,
  updatedAt: voiceRequest.updatedAt,
}

function toState(
  row: Pick<VoiceRequest, keyof typeof stateColumns>
): VoiceRequestState {
  return {
    ...row,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// Clears a finished result from Lor's window for everyone in the call.
export async function dismissVoiceRequest(requestId: string) {
  const [row] = await db
    .update(voiceRequest)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(voiceRequest.id, requestId),
        inArray(voiceRequest.status, ["done", "failed"]),
        isNull(voiceRequest.dismissedAt)
      )
    )
    .returning(stateColumns)
  return row ? toState(row) : null
}

export type VoiceRequestInput = Pick<
  NewVoiceRequest,
  "sessionId" | "participantId" | "heardText" | "startMs" | "endMs" | "gate"
> & {
  // Absent for a clicked choice, which skips address detection.
  check?: VoiceRequestCheck
  status: "listening" | "rejected" | "queued"
}

// Inserted with its first check's outcome. The requester is the participant's
// user; a request always runs as them.
export async function createVoiceRequest(input: VoiceRequestInput) {
  const { check, status, ...fields } = input
  const [participant] = await db
    .select({ userId: voiceSessionParticipant.userId })
    .from(voiceSessionParticipant)
    .where(
      and(
        eq(voiceSessionParticipant.id, input.participantId),
        eq(voiceSessionParticipant.sessionId, input.sessionId)
      )
    )
    .limit(1)
  if (!participant) return null
  const [row] = await db
    .insert(voiceRequest)
    .values({
      ...fields,
      userId: participant.userId,
      status,
      checks: check ? [check] : [],
      ...(status === "rejected" ? { finishedAt: new Date() } : {}),
    })
    .returning(stateColumns)
  return row ? toState(row) : null
}

// Appends the check and moves the request on, only while it's still
// listening, so a cancel or an earlier verdict wins. Null when nothing
// changed.
export async function recordVoiceRequestCheck(
  requestId: string,
  update: {
    check: VoiceRequestCheck
    status: "listening" | "rejected" | "queued"
    heardText: string
    endMs: number
  }
) {
  const [row] = await db
    .update(voiceRequest)
    .set({
      checks: sql`${voiceRequest.checks} || ${JSON.stringify([update.check])}::jsonb`,
      status: update.status,
      heardText: update.heardText,
      endMs: update.endMs,
      ...(update.status === "rejected" ? { finishedAt: new Date() } : {}),
    })
    .where(
      and(eq(voiceRequest.id, requestId), eq(voiceRequest.status, "listening"))
    )
    .returning(stateColumns)
  return row ? toState(row) : null
}

// The speaker never said what they wanted, or the transcriber left first.
export async function abandonVoiceRequest(requestId: string) {
  const [row] = await db
    .update(voiceRequest)
    .set({ status: "rejected", finishedAt: new Date() })
    .where(
      and(eq(voiceRequest.id, requestId), eq(voiceRequest.status, "listening"))
    )
    .returning(stateColumns)
  return row ? toState(row) : null
}

// Also returns the run, so the caller can stop it.
export async function markVoiceRequestCancelled(
  requestId: string,
  userId: string
) {
  const [row] = await db
    .update(voiceRequest)
    .set({
      status: "cancelled",
      cancelledById: userId,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(voiceRequest.id, requestId),
        inArray(voiceRequest.status, ACTIVE_STATUSES)
      )
    )
    .returning({ ...stateColumns, runId: voiceRequest.runId })
  if (!row) return null
  const { runId, ...state } = row
  return { request: toState(state), runId }
}

export async function findVoiceRequest(requestId: string) {
  const [row] = await db
    .select({ sessionId: voiceRequest.sessionId, result: voiceRequest.result })
    .from(voiceRequest)
    .where(eq(voiceRequest.id, requestId))
    .limit(1)
  return row ?? null
}

// Everything the worker needs to run a request.
export async function loadVoiceRequest(requestId: string) {
  const [row] = await db
    .select({
      ...stateColumns,
      runId: voiceRequest.runId,
      startMs: voiceRequest.startMs,
      gate: voiceRequest.gate,
      speakerName: user.name,
      workspaceId: voiceSession.workspaceId,
      channelId: voiceSession.channelId,
      threadRootId: voiceSession.threadRootId,
      sessionStartedAt: voiceSession.startedAt,
    })
    .from(voiceRequest)
    .innerJoin(voiceSession, eq(voiceSession.id, voiceRequest.sessionId))
    .innerJoin(user, eq(user.id, voiceRequest.userId))
    .where(eq(voiceRequest.id, requestId))
    .limit(1)
  return row ?? null
}

// Queued → working once its run exists. Null if it was cancelled first.
export async function startVoiceRequest(requestId: string, runId: string) {
  const [row] = await db
    .update(voiceRequest)
    .set({ status: "working", runId })
    .where(
      and(eq(voiceRequest.id, requestId), eq(voiceRequest.status, "queued"))
    )
    .returning(stateColumns)
  return row ? toState(row) : null
}

// A run can take on several requests (steering); the newest is on stage.
async function newestRunRequestId(runId: string) {
  const [row] = await db
    .select({ id: voiceRequest.id })
    .from(voiceRequest)
    .where(
      and(eq(voiceRequest.runId, runId), eq(voiceRequest.status, "working"))
    )
    .orderBy(desc(voiceRequest.createdAt))
    .limit(1)
  return row?.id ?? null
}

// What Lor's window shows, replaced each time the run calls the stage tool.
// It goes with the newest request the run took on.
export async function setRunVoiceResult(
  runId: string,
  result: VoiceRequestResult
) {
  const requestId = await newestRunRequestId(runId)
  if (!requestId) return null
  const [row] = await db
    .update(voiceRequest)
    .set({ result })
    .where(
      and(eq(voiceRequest.id, requestId), eq(voiceRequest.status, "working"))
    )
    .returning(stateColumns)
  return row ? toState(row) : null
}

// Requests made in the call while a run works: the run claims them at its
// next step, so Lor hears them mid-task and decides what they change.
export async function claimQueuedVoiceRequests(
  sessionId: string,
  runId: string
) {
  const claimed = await db
    .update(voiceRequest)
    .set({ status: "working", runId })
    .where(
      and(
        eq(voiceRequest.sessionId, sessionId),
        eq(voiceRequest.status, "queued")
      )
    )
    .returning({ ...stateColumns, gate: voiceRequest.gate })
  if (claimed.length === 0) return []
  const names = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(
      inArray(
        user.id,
        claimed.map((row) => row.userId)
      )
    )
  const nameById = new Map(names.map((row) => [row.id, row.name]))
  return claimed
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(({ gate, ...row }) => ({
      request: toState(row),
      gate,
      speakerName: nameById.get(row.userId) ?? "Someone",
    }))
}

// Ends every request a run took on. `fallback` fills the newest one's empty
// result, e.g. the run's final reply when it never called the stage tool.
export async function finishRunVoiceRequests(
  runId: string,
  update: {
    status: "done" | "failed" | "cancelled"
    fallback?: VoiceRequestResult
  }
) {
  const newestId = await newestRunRequestId(runId)
  const rows = await db
    .update(voiceRequest)
    .set({
      status: update.status,
      finishedAt: new Date(),
      ...(update.fallback && newestId
        ? {
            result: sql`case when ${voiceRequest.id} = ${newestId} then coalesce(${voiceRequest.result}, ${JSON.stringify(update.fallback)}::jsonb) else ${voiceRequest.result} end`,
          }
        : {}),
    })
    .where(
      and(eq(voiceRequest.runId, runId), eq(voiceRequest.status, "working"))
    )
    .returning(stateColumns)
  return rows.map(toState)
}

// Whether the newest request on a run has something on stage.
export async function runVoiceResultShown(runId: string) {
  const requestId = await newestRunRequestId(runId)
  if (!requestId) return false
  const [row] = await db
    .select({ result: voiceRequest.result })
    .from(voiceRequest)
    .where(eq(voiceRequest.id, requestId))
    .limit(1)
  return Boolean(row?.result)
}

// What Lor showed for earlier requests in the call, oldest first, so
// follow-ups like "open the second one" have something to refer to.
export async function listShownVoiceRequests(
  sessionId: string,
  options: { before: Date; limit: number }
) {
  const rows = await db
    .select({
      heardText: voiceRequest.heardText,
      result: voiceRequest.result,
      createdAt: voiceRequest.createdAt,
      speakerName: user.name,
    })
    .from(voiceRequest)
    .innerJoin(user, eq(user.id, voiceRequest.userId))
    .where(
      and(
        eq(voiceRequest.sessionId, sessionId),
        eq(voiceRequest.status, "done"),
        isNotNull(voiceRequest.result),
        lt(voiceRequest.createdAt, options.before)
      )
    )
    .orderBy(desc(voiceRequest.createdAt))
    .limit(options.limit)
  return rows.reverse()
}

// Where in the call each request Lor took on was said, for continuing the
// call's runs: their words already reached Lor as requests.
export async function listRunVoiceRequestSpans(sessionId: string) {
  return await db
    .select({
      runId: voiceRequest.runId,
      startMs: voiceRequest.startMs,
      endMs: voiceRequest.endMs,
    })
    .from(voiceRequest)
    .where(
      and(eq(voiceRequest.sessionId, sessionId), isNotNull(voiceRequest.runId))
    )
}

// Ends a request that is still in flight. `fallback` fills an empty result,
// e.g. the run's final reply when it never called the stage tool.
export async function finishVoiceRequest(
  requestId: string,
  update: { status: "done" | "failed"; fallback?: VoiceRequestResult }
) {
  const [row] = await db
    .update(voiceRequest)
    .set({
      status: update.status,
      finishedAt: new Date(),
      ...(update.fallback
        ? {
            result: sql`coalesce(${voiceRequest.result}, ${JSON.stringify(update.fallback)}::jsonb)`,
          }
        : {}),
    })
    .where(
      and(
        eq(voiceRequest.id, requestId),
        inArray(voiceRequest.status, ["queued", "working"])
      )
    )
    .returning(stateColumns)
  return row ? toState(row) : null
}

// Everything Lor's window and the Lor tab can show; rejected lines were never
// requests.
export async function listSessionVoiceRequests(sessionId: string) {
  const rows = await db
    .select(stateColumns)
    .from(voiceRequest)
    .where(
      and(
        eq(voiceRequest.sessionId, sessionId),
        ne(voiceRequest.status, "rejected")
      )
    )
    .orderBy(asc(voiceRequest.createdAt))
  return rows.map(toState)
}
