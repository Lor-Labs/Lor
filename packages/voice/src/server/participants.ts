import { and, count, db, eq, isNotNull, isNull, ne, schema } from "@repo/db"

const { voiceSession, voiceSessionParticipant } = schema

export async function countConnectedParticipants(
  sessionId: string,
  excludeUserId?: string
) {
  const [row] = await db
    .select({ value: count() })
    .from(voiceSessionParticipant)
    .where(
      and(
        eq(voiceSessionParticipant.sessionId, sessionId),
        isNotNull(voiceSessionParticipant.connectedAt),
        excludeUserId
          ? ne(voiceSessionParticipant.userId, excludeUserId)
          : undefined
      )
    )
  return row?.value ?? 0
}

// The last person out starts the session's grace period.
async function startGraceIfEmpty(sessionId: string, at: Date) {
  if ((await countConnectedParticipants(sessionId)) > 0) return
  await db
    .update(voiceSession)
    .set({ emptySince: at })
    .where(
      and(
        eq(voiceSession.id, sessionId),
        isNull(voiceSession.endedAt),
        isNull(voiceSession.emptySince)
      )
    )
}

// Ended sessions stay ended: a late connect never revives one.
export async function markParticipantConnected(
  sessionId: string,
  participantId: string,
  at: Date
) {
  const [live] = await db
    .select({ id: voiceSession.id })
    .from(voiceSession)
    .where(and(eq(voiceSession.id, sessionId), isNull(voiceSession.endedAt)))
    .limit(1)
  if (!live) return

  const updated = await db
    .update(voiceSessionParticipant)
    .set({ connectedAt: at })
    .where(
      and(
        eq(voiceSessionParticipant.id, participantId),
        eq(voiceSessionParticipant.sessionId, sessionId),
        isNull(voiceSessionParticipant.connectedAt)
      )
    )
    .returning({ id: voiceSessionParticipant.id })
  if (updated.length === 0) return

  await db
    .update(voiceSession)
    .set({ emptySince: null })
    .where(eq(voiceSession.id, sessionId))
}

type ParticipantMatch = { userId: string } | { participantId: string }

// Shared by the leave route (a client hint), the LiveKit webhook, and the
// voice sync job.
export async function markParticipantLeft(
  sessionId: string,
  match: ParticipantMatch,
  at = new Date()
) {
  const who =
    "userId" in match
      ? eq(voiceSessionParticipant.userId, match.userId)
      : eq(voiceSessionParticipant.id, match.participantId)
  await db
    .update(voiceSessionParticipant)
    .set({ connectedAt: null, lastLeftAt: at })
    .where(
      and(
        eq(voiceSessionParticipant.sessionId, sessionId),
        who,
        isNotNull(voiceSessionParticipant.connectedAt)
      )
    )
  await startGraceIfEmpty(sessionId, at)
}

// LiveKit closed the room, so nobody is connected.
export async function markSessionEmpty(sessionId: string, at = new Date()) {
  await db
    .update(voiceSessionParticipant)
    .set({ connectedAt: null, lastLeftAt: at })
    .where(
      and(
        eq(voiceSessionParticipant.sessionId, sessionId),
        isNotNull(voiceSessionParticipant.connectedAt)
      )
    )
  await startGraceIfEmpty(sessionId, at)
}
