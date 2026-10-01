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

// Everyone who joined the session, keyed by participant id, so live captions
// from people who haven't spoken yet still get a name and avatar.
async function listTranscriptParticipants(
  sessionId: string,
  workspaceId: string
) {
  return db
    .select({
      id: voiceSessionParticipant.id,
      userId: voiceSessionParticipant.userId,
      name: user.name,
      image: user.image,
      avatarColor: workspaceMember.avatarColor,
    })
    .from(voiceSessionParticipant)
    .innerJoin(user, eq(user.id, voiceSessionParticipant.userId))
    .leftJoin(
      workspaceMember,
      and(
        eq(workspaceMember.userId, voiceSessionParticipant.userId),
        eq(workspaceMember.workspaceId, workspaceId)
      )
    )
    .where(eq(voiceSessionParticipant.sessionId, sessionId))
}

// Keyset pages in timeline order; `after` is the last segment id of the
// previous page.
export async function listTranscript(
  sessionId: string,
  options: { after?: string; limit: number }
) {
  const [session] = await db
    .select({
      startedAt: voiceSession.startedAt,
      workspaceId: voiceSession.workspaceId,
    })
    .from(voiceSession)
    .where(eq(voiceSession.id, sessionId))
    .limit(1)
  if (!session) return null

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
  const participants = await listTranscriptParticipants(
    sessionId,
    session.workspaceId
  )
  if (options.after && !cursor) {
    return {
      startedAt: session.startedAt.toISOString(),
      participants,
      segments: [],
      gaps: [],
      nextAfter: null,
    }
  }

  const rows = await db
    .select({
      id: voiceTranscriptSegment.id,
      segmentId: voiceTranscriptSegment.segmentId,
      participantId: voiceTranscriptSegment.participantId,
      startMs: voiceTranscriptSegment.startMs,
      endMs: voiceTranscriptSegment.endMs,
      text: voiceTranscriptSegment.text,
    })
    .from(voiceTranscriptSegment)
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
    startedAt: session.startedAt.toISOString(),
    participants,
    segments: page,
    gaps,
    nextAfter: rows.length > options.limit ? (page.at(-1)?.id ?? null) : null,
  }
}
