import { and, asc, db, eq, inArray, ne, schema, sql } from "@repo/db"
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
  createdAt: voiceRequest.createdAt,
  updatedAt: voiceRequest.updatedAt,
}

function toState(
  row: Pick<VoiceRequest, keyof typeof stateColumns>
): VoiceRequestState {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type VoiceRequestInput = Pick<
  NewVoiceRequest,
  "sessionId" | "participantId" | "heardText" | "startMs" | "endMs" | "gate"
> & {
  check: VoiceRequestCheck
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
      checks: [check],
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
    .select({ sessionId: voiceRequest.sessionId })
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

// What Lor's window shows, replaced each time the run calls the stage tool.
export async function setVoiceRequestResult(
  requestId: string,
  result: VoiceRequestResult
) {
  const [row] = await db
    .update(voiceRequest)
    .set({ result })
    .where(
      and(eq(voiceRequest.id, requestId), eq(voiceRequest.status, "working"))
    )
    .returning(stateColumns)
  return row ? toState(row) : null
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
