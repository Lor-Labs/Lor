import {
  and,
  count,
  db,
  desc,
  eq,
  isNotNull,
  isNull,
  lte,
  ne,
  schema,
} from "@repo/db"
import type { VoiceCallState } from "@repo/realtime-types/events"
import { notifyVoiceCall, notifyVoicePresence } from "./notify"

const { channel, voiceSession, voiceSessionParticipant, workspace } = schema

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

// The live call the user is connected to on any device.
export async function getCurrentCall(
  userId: string
): Promise<VoiceCallState | null> {
  const [row] = await db
    .select({
      sessionId: voiceSession.id,
      channelId: voiceSession.channelId,
      channelName: channel.name,
      workspaceId: voiceSession.workspaceId,
      workspaceSlug: workspace.slug,
    })
    .from(voiceSessionParticipant)
    .innerJoin(
      voiceSession,
      eq(voiceSession.id, voiceSessionParticipant.sessionId)
    )
    .innerJoin(channel, eq(channel.id, voiceSession.channelId))
    .innerJoin(workspace, eq(workspace.id, voiceSession.workspaceId))
    .where(
      and(
        eq(voiceSessionParticipant.userId, userId),
        isNotNull(voiceSessionParticipant.connectedAt),
        isNull(voiceSession.endedAt)
      )
    )
    .orderBy(desc(voiceSessionParticipant.connectedAt))
    .limit(1)
  return row ?? null
}

// Announces committed changes. Each user gets their current call read back
// from the database rather than a delta, so reordered joins and leaves still
// leave every device with the right final state.
async function announce(sessionId: string, userIds: string[]) {
  if (userIds.length === 0) return
  const [session] = await db
    .select({ workspaceId: voiceSession.workspaceId })
    .from(voiceSession)
    .where(eq(voiceSession.id, sessionId))
    .limit(1)
  if (session) notifyVoicePresence(session.workspaceId)
  for (const userId of userIds) {
    notifyVoiceCall(userId, await getCurrentCall(userId))
  }
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
    .returning({ userId: voiceSessionParticipant.userId })
  if (updated.length === 0) return

  await db
    .update(voiceSession)
    .set({ emptySince: null })
    .where(eq(voiceSession.id, sessionId))
  await announce(
    sessionId,
    updated.map((row) => row.userId)
  )
}

type ParticipantMatch = { userId: string } | { participantId: string }

// Shared by the leave route (a client hint), the LiveKit webhook, and the
// voice sync job.
export async function markParticipantLeft(
  sessionId: string,
  match: ParticipantMatch,
  options: { at?: Date; connectionJoinedAt?: Date } = {}
) {
  const at = options.at ?? new Date()
  const who =
    "userId" in match
      ? eq(voiceSessionParticipant.userId, match.userId)
      : eq(voiceSessionParticipant.id, match.participantId)
  const left = await db
    .update(voiceSessionParticipant)
    .set({ connectedAt: null, lastLeftAt: at })
    .where(
      and(
        eq(voiceSessionParticipant.sessionId, sessionId),
        who,
        isNotNull(voiceSessionParticipant.connectedAt),
        // "Transfer here" replaces a connection under the same identity; the
        // old connection's leave must not clear the new connection.
        options.connectionJoinedAt
          ? lte(voiceSessionParticipant.connectedAt, options.connectionJoinedAt)
          : undefined
      )
    )
    .returning({ userId: voiceSessionParticipant.userId })
  await startGraceIfEmpty(sessionId, at)
  await announce(
    sessionId,
    left.map((row) => row.userId)
  )
}

// LiveKit closed the room, so nobody is connected.
export async function markSessionEmpty(sessionId: string, at = new Date()) {
  const left = await db
    .update(voiceSessionParticipant)
    .set({ connectedAt: null, lastLeftAt: at })
    .where(
      and(
        eq(voiceSessionParticipant.sessionId, sessionId),
        isNotNull(voiceSessionParticipant.connectedAt)
      )
    )
    .returning({ userId: voiceSessionParticipant.userId })
  await startGraceIfEmpty(sessionId, at)
  await announce(
    sessionId,
    left.map((row) => row.userId)
  )
}
