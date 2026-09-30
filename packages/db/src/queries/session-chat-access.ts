import {
  type AnyColumn,
  and,
  eq,
  isNotNull,
  isNull,
  notExists,
  type SQL,
} from "drizzle-orm"
import { db } from "../index"
import { voiceSession, voiceSessionParticipant } from "../schemas/voice"

// Live-only rule for voice session chats: while a session is live, the thread
// under its voice_session root is visible only to people connected to the
// call. Once the session ends, normal channel access applies. Callers check
// channel access separately.

export async function isLiveSessionChat(threadRootId: string) {
  const [row] = await db
    .select({ id: voiceSession.id })
    .from(voiceSession)
    .where(
      and(
        eq(voiceSession.threadRootId, threadRootId),
        isNull(voiceSession.endedAt)
      )
    )
    .limit(1)
  return Boolean(row)
}

// True for any thread that isn't a live session chat.
export async function canSeeSessionChat(userId: string, threadRootId: string) {
  const [row] = await db
    .select({ participantId: voiceSessionParticipant.id })
    .from(voiceSession)
    .leftJoin(
      voiceSessionParticipant,
      and(
        eq(voiceSessionParticipant.sessionId, voiceSession.id),
        eq(voiceSessionParticipant.userId, userId),
        isNotNull(voiceSessionParticipant.connectedAt)
      )
    )
    .where(
      and(
        eq(voiceSession.threadRootId, threadRootId),
        isNull(voiceSession.endedAt)
      )
    )
    .limit(1)
  return !row || row.participantId !== null
}

// People connected to the call when the thread is a live session chat, else
// null. Message fanout uses it to keep live chat previews inside the call.
export async function liveSessionChatMembers(
  threadRootId: string
): Promise<Set<string> | null> {
  const rows = await db
    .select({ userId: voiceSessionParticipant.userId })
    .from(voiceSession)
    .leftJoin(
      voiceSessionParticipant,
      and(
        eq(voiceSessionParticipant.sessionId, voiceSession.id),
        isNotNull(voiceSessionParticipant.connectedAt)
      )
    )
    .where(
      and(
        eq(voiceSession.threadRootId, threadRootId),
        isNull(voiceSession.endedAt)
      )
    )
  if (rows.length === 0) return null
  return new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])))
}

// Lor retrieval: a live session's chat stays out of reach until the call ends.
export function outsideLiveSessionChatFilter(threadRootId: AnyColumn | SQL) {
  return notExists(
    db
      .select({ id: voiceSession.id })
      .from(voiceSession)
      .where(
        and(
          eq(voiceSession.threadRootId, threadRootId),
          isNull(voiceSession.endedAt)
        )
      )
  )
}

// SQL twin of canSeeSessionChat for list queries: keeps rows whose thread
// isn't a live session chat hidden from the user.
export function visibleToSessionChatFilter(
  userId: string,
  threadRootId: AnyColumn | SQL
) {
  return notExists(
    db
      .select({ id: voiceSession.id })
      .from(voiceSession)
      .where(
        and(
          eq(voiceSession.threadRootId, threadRootId),
          isNull(voiceSession.endedAt),
          notExists(
            db
              .select({ id: voiceSessionParticipant.id })
              .from(voiceSessionParticipant)
              .where(
                and(
                  eq(voiceSessionParticipant.sessionId, voiceSession.id),
                  eq(voiceSessionParticipant.userId, userId),
                  isNotNull(voiceSessionParticipant.connectedAt)
                )
              )
          )
        )
      )
  )
}
