import {
  and,
  count,
  db,
  eq,
  isNotNull,
  isNull,
  isUniqueViolation,
  ne,
  schema,
} from "@repo/db"
import { MAX_CALL_PARTICIPANTS } from "@repo/voice"
import { logger } from "@/lib/logger"
import { getRoomService, type LiveKitConfig } from "@/lib/voice/livekit"

const { message, voiceSession, voiceSessionParticipant } = schema

type SessionChannel = { id: string; workspaceId: string }

async function findLiveSession(channelId: string) {
  const [row] = await db
    .select()
    .from(voiceSession)
    .where(
      and(eq(voiceSession.channelId, channelId), isNull(voiceSession.endedAt))
    )
    .limit(1)
  return row ?? null
}

// One live session per channel (partial unique index). A new session starts
// empty; the first LiveKit connection clears emptySince. The loser of a
// concurrent first join adopts the winner's session.
export async function getOrCreateLiveSession(
  channel: SessionChannel,
  userId: string
) {
  const existing = await findLiveSession(channel.id)
  if (existing) return existing

  const now = new Date()
  try {
    return await db.transaction(async (tx) => {
      const [root] = await tx
        .insert(message)
        .values({
          channelId: channel.id,
          authorId: userId,
          type: "voice_session",
          content: "Voice session",
          excludedFromMemory: true,
        })
        .returning({ id: message.id })
      if (!root) throw new Error("Voice session root message was not created")

      const [session] = await tx
        .insert(voiceSession)
        .values({
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          threadRootId: root.id,
          createdById: userId,
          startedAt: now,
          emptySince: now,
        })
        .returning()
      if (!session) throw new Error("Voice session was not created")
      return session
    })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    const winner = await findLiveSession(channel.id)
    if (!winner) throw err
    return winner
  }
}

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

// Shared by the leave route (a client hint) and the LiveKit webhook (the
// authority). The last person out starts the session's grace period.
export async function markParticipantLeft(sessionId: string, userId: string) {
  const now = new Date()
  await db
    .update(voiceSessionParticipant)
    .set({ connectedAt: null, lastLeftAt: now })
    .where(
      and(
        eq(voiceSessionParticipant.sessionId, sessionId),
        eq(voiceSessionParticipant.userId, userId),
        isNotNull(voiceSessionParticipant.connectedAt)
      )
    )

  if ((await countConnectedParticipants(sessionId)) > 0) return
  await db
    .update(voiceSession)
    .set({ emptySince: now })
    .where(
      and(
        eq(voiceSession.id, sessionId),
        isNull(voiceSession.endedAt),
        isNull(voiceSession.emptySince)
      )
    )
}

export function isSessionFull(connectedOthers: number) {
  return connectedOthers >= MAX_CALL_PARTICIPANTS
}

// One call per person: joining a session drops the person from any other
// live call. Joining the same session again reuses the identity, which is
// the "Transfer here" path.
export async function leaveOtherCalls(
  livekit: LiveKitConfig,
  userId: string,
  keepSessionId: string
) {
  const others = await db
    .select({
      participantId: voiceSessionParticipant.id,
      sessionId: voiceSessionParticipant.sessionId,
    })
    .from(voiceSessionParticipant)
    .innerJoin(
      voiceSession,
      eq(voiceSession.id, voiceSessionParticipant.sessionId)
    )
    .where(
      and(
        eq(voiceSessionParticipant.userId, userId),
        isNotNull(voiceSessionParticipant.connectedAt),
        isNull(voiceSession.endedAt),
        ne(voiceSessionParticipant.sessionId, keepSessionId)
      )
    )
  if (others.length === 0) return

  const roomService = getRoomService(livekit)
  await Promise.all(
    others.map(async ({ participantId, sessionId }) => {
      try {
        await roomService.removeParticipant(sessionId, participantId)
      } catch (err) {
        logger.warn(
          { err, sessionId, participantId },
          "voice: remove from previous call failed"
        )
      }
    })
  )
}

export async function upsertParticipant(sessionId: string, userId: string) {
  const [row] = await db
    .insert(voiceSessionParticipant)
    .values({ sessionId, userId })
    .onConflictDoUpdate({
      target: [
        voiceSessionParticipant.sessionId,
        voiceSessionParticipant.userId,
      ],
      set: { userId },
    })
    .returning({ id: voiceSessionParticipant.id })
  if (!row) throw new Error("Voice participant was not created")
  return row.id
}
