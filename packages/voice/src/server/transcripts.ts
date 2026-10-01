import { and, asc, db, eq, schema, sql } from "@repo/db"
import type {
  NewVoiceCaptureGap,
  NewVoiceTranscriptSegment,
} from "@repo/db/schema"

const {
  user,
  voiceCaptureGap,
  voiceSession,
  voiceSessionParticipant,
  voiceTranscriptSegment,
  workspaceMember,
} = schema

export type TranscriptSegmentInput = Omit<
  NewVoiceTranscriptSegment,
  "id" | "createdAt" | "updatedAt"
>
export type CaptureGapInput = Omit<NewVoiceCaptureGap, "id" | "createdAt">

// Idempotent per segment: a retry is a no-op, and a higher revision replaces
// the text.
export async function recordTranscriptSegment(input: TranscriptSegmentInput) {
  await db
    .insert(voiceTranscriptSegment)
    .values(input)
    .onConflictDoUpdate({
      target: [
        voiceTranscriptSegment.sessionId,
        voiceTranscriptSegment.segmentId,
      ],
      set: {
        revision: sql`excluded.revision`,
        startMs: sql`excluded.start_ms`,
        endMs: sql`excluded.end_ms`,
        text: sql`excluded.text`,
        updatedAt: new Date(),
      },
      setWhere: sql`excluded.revision > ${voiceTranscriptSegment.revision}`,
    })
}

export async function recordCaptureGap(input: CaptureGapInput) {
  await db.insert(voiceCaptureGap).values(input)
}

// Keyset pages in timeline order; `after` is the last segment id of the
// previous page.
export async function listTranscript(
  sessionId: string,
  options: { after?: string; limit: number }
) {
  const [cursor] = options.after
    ? await db
        .select({
          startMs: voiceTranscriptSegment.startMs,
          id: voiceTranscriptSegment.id,
        })
        .from(voiceTranscriptSegment)
        .where(
          and(
            eq(voiceTranscriptSegment.id, options.after),
            eq(voiceTranscriptSegment.sessionId, sessionId)
          )
        )
        .limit(1)
    : []
  if (options.after && !cursor)
    return { segments: [], gaps: [], nextAfter: null }

  const rows = await db
    .select({
      id: voiceTranscriptSegment.id,
      participantId: voiceTranscriptSegment.participantId,
      startMs: voiceTranscriptSegment.startMs,
      endMs: voiceTranscriptSegment.endMs,
      text: voiceTranscriptSegment.text,
      userId: voiceSessionParticipant.userId,
      name: user.name,
      image: user.image,
      avatarColor: workspaceMember.avatarColor,
    })
    .from(voiceTranscriptSegment)
    .innerJoin(
      voiceSessionParticipant,
      eq(voiceSessionParticipant.id, voiceTranscriptSegment.participantId)
    )
    .innerJoin(user, eq(user.id, voiceSessionParticipant.userId))
    .innerJoin(
      voiceSession,
      eq(voiceSession.id, voiceTranscriptSegment.sessionId)
    )
    .leftJoin(
      workspaceMember,
      and(
        eq(workspaceMember.userId, voiceSessionParticipant.userId),
        eq(workspaceMember.workspaceId, voiceSession.workspaceId)
      )
    )
    .where(
      and(
        eq(voiceTranscriptSegment.sessionId, sessionId),
        cursor
          ? sql`(${voiceTranscriptSegment.startMs}, ${voiceTranscriptSegment.id}) > (${cursor.startMs}, ${cursor.id})`
          : undefined
      )
    )
    .orderBy(
      asc(voiceTranscriptSegment.startMs),
      asc(voiceTranscriptSegment.id)
    )
    .limit(options.limit + 1)

  const page = rows.slice(0, options.limit)
  const gaps = await db
    .select({
      participantId: voiceCaptureGap.participantId,
      startMs: voiceCaptureGap.startMs,
      endMs: voiceCaptureGap.endMs,
      reason: voiceCaptureGap.reason,
    })
    .from(voiceCaptureGap)
    .where(eq(voiceCaptureGap.sessionId, sessionId))
    .orderBy(asc(voiceCaptureGap.startMs))

  return {
    segments: page.map((row) => ({
      id: row.id,
      participantId: row.participantId,
      speaker: {
        userId: row.userId,
        name: row.name,
        image: row.image,
        avatarColor: row.avatarColor,
      },
      startMs: row.startMs,
      endMs: row.endMs,
      text: row.text,
    })),
    gaps,
    nextAfter: rows.length > options.limit ? (page.at(-1)?.id ?? null) : null,
  }
}
