import { and, asc, db, eq, inArray, ne, schema, sql } from "@repo/db"
import type {
  NewVoiceRequest,
  VoiceRequest,
  VoiceRequestCheck,
} from "@repo/db/schema"
import type { VoiceRequestState } from "@repo/realtime-types/events"

const { voiceRequest, voiceSessionParticipant } = schema

// A request someone can still cancel.
const ACTIVE_STATUSES = ["listening", "queued", "working"] as const

const stateColumns = {
  id: voiceRequest.id,
  sessionId: voiceRequest.sessionId,
  participantId: voiceRequest.participantId,
  userId: voiceRequest.userId,
  heardText: voiceRequest.heardText,
  status: voiceRequest.status,
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
    .returning(stateColumns)
  return row ? toState(row) : null
}

export async function findVoiceRequest(requestId: string) {
  const [row] = await db
    .select({ sessionId: voiceRequest.sessionId })
    .from(voiceRequest)
    .where(eq(voiceRequest.id, requestId))
    .limit(1)
  return row ?? null
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
