import { and, db, eq, schema, sql } from "@repo/db"
import type { NewVoiceRequest, VoiceRequestCheck } from "@repo/db/schema"

const { voiceRequest, voiceSessionParticipant } = schema

export type VoiceRequestInput = Pick<
  NewVoiceRequest,
  "sessionId" | "participantId" | "heardText" | "startMs" | "endMs" | "gate"
>

// The requester is the participant's user; a request always runs as them.
export async function createVoiceRequest(input: VoiceRequestInput) {
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
    .values({ ...input, userId: participant.userId })
    .returning({ id: voiceRequest.id })
  return row?.id ?? null
}

// Appends the check and moves the request on, only while it's still
// listening, so a cancel or an earlier verdict wins. False when nothing
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
  const rows = await db
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
    .returning({ id: voiceRequest.id })
  return rows.length > 0
}

// The transcriber left before the speaker finished.
export async function abandonVoiceRequest(requestId: string) {
  await db
    .update(voiceRequest)
    .set({ status: "rejected", finishedAt: new Date() })
    .where(
      and(eq(voiceRequest.id, requestId), eq(voiceRequest.status, "listening"))
    )
}
