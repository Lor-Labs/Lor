import {
  and,
  db,
  eq,
  isNotNull,
  isNull,
  isUniqueViolation,
  ne,
  schema,
} from "@repo/db"
import { MAX_CALL_PARTICIPANTS } from "@repo/voice"
import {
  confirmLiveSession,
  getRoomService,
  type LiveKitConfig,
} from "@repo/voice/server"
import { logger } from "@/lib/logger"

const { message, voiceSession, voiceSessionParticipant } = schema

type SessionChannel = { id: string; workspaceId: string }

export async function findSessionScope(sessionId: string) {
  const [row] = await db
    .select({
      workspaceId: voiceSession.workspaceId,
      channelId: voiceSession.channelId,
      threadRootId: voiceSession.threadRootId,
      startedAt: voiceSession.startedAt,
      endedAt: voiceSession.endedAt,
    })
    .from(voiceSession)
    .where(eq(voiceSession.id, sessionId))
    .limit(1)
  return row ?? null
}

// The user's row in a live session, if they're connected to it.
export async function findConnectedParticipant(
  sessionId: string,
  userId: string
) {
  const [row] = await db
    .select({ id: voiceSessionParticipant.id })
    .from(voiceSessionParticipant)
    .where(
      and(
        eq(voiceSessionParticipant.sessionId, sessionId),
        eq(voiceSessionParticipant.userId, userId),
        isNotNull(voiceSessionParticipant.connectedAt)
      )
    )
    .limit(1)
  return row ?? null
}

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

// A failed check keeps the session: a LiveKit hiccup shouldn't block joins.
async function stillLive(livekit: LiveKitConfig, sessionId: string) {
  try {
    return await confirmLiveSession(livekit, sessionId)
  } catch (err) {
    logger.warn({ err, sessionId }, "voice: could not confirm live session")
    return true
  }
}

// One live session per channel (partial unique index). A new session starts
// empty; the first LiveKit connection clears emptySince. The loser of a
// concurrent first join adopts the winner's session.
export async function getOrCreateLiveSession(
  livekit: LiveKitConfig,
  channel: SessionChannel,
  userId: string
) {
  const existing = await findLiveSession(channel.id)
  if (existing && (await stillLive(livekit, existing.id))) return existing

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
