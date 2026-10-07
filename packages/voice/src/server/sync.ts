import { and, db, eq, isNotNull, isNull, lte, schema } from "@repo/db"
import { ServerError } from "livekit-server-sdk"
import { VOICE_SESSION_GRACE_MS } from "../index"
import {
  dispatchTranscriber,
  getRoomService,
  type LiveKitConfig,
} from "./livekit"
import { notifyVoicePresence, notifyVoiceSessionEnded } from "./notify"
import { markParticipantConnected, markParticipantLeft } from "./participants"
import {
  recordMissedTranscriberAtEnd,
  transcriberMissing,
} from "./transcriber-lease"

const { voiceSession, voiceSessionParticipant } = schema

type SyncFailure = { sessionId: string; err: unknown }

// Who LiveKit says is in the room, by identity, with when each joined.
export async function listRoomIdentities(
  config: LiveKitConfig,
  sessionId: string
) {
  try {
    const participants =
      await getRoomService(config).listParticipants(sessionId)
    return new Map(
      participants.map((participant) => [
        participant.identity,
        new Date(Number(participant.joinedAtMs) || Date.now()),
      ])
    )
  } catch (err) {
    // LiveKit already closed the room, so nobody is in it.
    if (err instanceof ServerError && err.status === 404) return new Map()
    throw err
  }
}

// The last time anyone was known to be in the call: a connection, a leave,
// or a transcriber renewal (it renews only while people are in the call).
function lastPresence(times: (Date | null)[]) {
  const known = times.flatMap((at) => (at ? [at.getTime()] : []))
  return known.length > 0 ? new Date(Math.max(...known)) : undefined
}

// Makes the database match who LiveKit says is in the room, and returns how
// many of the session's participants are connected.
export async function reconcileSession(
  config: LiveKitConfig,
  sessionId: string
) {
  // A connection newer than LiveKit's snapshot isn't in it but is real.
  const snapshotAt = new Date()
  const inRoom = await listRoomIdentities(config, sessionId)
  const [session] = await db
    .select({ transcriberSeenAt: voiceSession.transcriberSeenAt })
    .from(voiceSession)
    .where(eq(voiceSession.id, sessionId))
    .limit(1)
  const rows = await db
    .select({
      id: voiceSessionParticipant.id,
      connectedAt: voiceSessionParticipant.connectedAt,
      lastLeftAt: voiceSessionParticipant.lastLeftAt,
    })
    .from(voiceSessionParticipant)
    .where(eq(voiceSessionParticipant.sessionId, sessionId))

  // With nobody left in the room, the missed leaves happened at the last sign
  // of presence, not now, so a long-abandoned session ends when it emptied.
  const emptiedAt = rows.some((row) => inRoom.has(row.id))
    ? undefined
    : lastPresence([
        session?.transcriberSeenAt ?? null,
        ...rows.flatMap((row) => [row.connectedAt, row.lastLeftAt]),
      ])

  let connected = 0
  for (const row of rows) {
    const joinedAt = inRoom.get(row.id)
    if (joinedAt) {
      connected += 1
      if (!row.connectedAt) {
        await markParticipantConnected(sessionId, row.id, joinedAt)
      }
    } else if (row.connectedAt) {
      await markParticipantLeft(
        sessionId,
        { participantId: row.id },
        { at: emptiedAt, connectionJoinedAt: snapshotAt }
      )
    }
  }
  return connected
}

// Compare-and-set: a rejoin since the read resets emptySince and wins.
async function endSession(sessionId: string, emptySince: Date) {
  const [row] = await db
    .update(voiceSession)
    .set({ endedAt: emptySince })
    .where(
      and(
        eq(voiceSession.id, sessionId),
        isNull(voiceSession.endedAt),
        eq(voiceSession.emptySince, emptySince)
      )
    )
    .returning({
      workspaceId: voiceSession.workspaceId,
      startedAt: voiceSession.startedAt,
      transcriberJobId: voiceSession.transcriberJobId,
      transcriberSeenAt: voiceSession.transcriberSeenAt,
    })
  if (!row) return false
  // Lets open voice channel pages move the session into history.
  notifyVoicePresence(row.workspaceId)
  await recordMissedTranscriberAtEnd({
    ...row,
    id: sessionId,
    endedAt: emptySince,
  })
  // After the gap above is recorded, so the summary sees it.
  notifyVoiceSessionEnded(sessionId)
  return true
}

// Before a join reuses a live session: catch leaves the webhook and audit
// missed, and end the session if it has been empty past the grace period.
// False means it ended, so the join starts a new session.
export async function confirmLiveSession(
  config: LiveKitConfig,
  sessionId: string
) {
  if ((await reconcileSession(config, sessionId)) > 0) return true
  const [row] = await db
    .select({ emptySince: voiceSession.emptySince })
    .from(voiceSession)
    .where(and(eq(voiceSession.id, sessionId), isNull(voiceSession.endedAt)))
    .limit(1)
  if (!row) return false
  const { emptySince } = row
  if (
    !emptySince ||
    emptySince.getTime() > Date.now() - VOICE_SESSION_GRACE_MS
  ) {
    return true
  }
  return !(await endSession(sessionId, emptySince))
}

// Every 30s. Only sessions past the grace period reach LiveKit, once each, to
// confirm the room is really empty before the session ends.
export async function endExpiredSessions(config: LiveKitConfig) {
  const cutoff = new Date(Date.now() - VOICE_SESSION_GRACE_MS)
  const candidates = await db
    .select({ id: voiceSession.id, emptySince: voiceSession.emptySince })
    .from(voiceSession)
    .where(
      and(
        isNull(voiceSession.endedAt),
        isNotNull(voiceSession.emptySince),
        lte(voiceSession.emptySince, cutoff)
      )
    )

  const ended: string[] = []
  const failed: SyncFailure[] = []
  for (const { id, emptySince } of candidates) {
    if (!emptySince) continue
    try {
      if ((await reconcileSession(config, id)) > 0) {
        await db
          .update(voiceSession)
          .set({ emptySince: null })
          .where(eq(voiceSession.id, id))
        continue
      }
      if (await endSession(id, emptySince)) ended.push(id)
    } catch (err) {
      failed.push({ sessionId: id, err })
    }
  }
  return { ended, failed }
}

// Every 10 minutes. Catches missed "left" webhooks on sessions the database
// still thinks are occupied, and sends a transcriber to occupied rooms
// without one. The new transcriber records the stretch it missed.
export async function auditLiveSessions(config: LiveKitConfig) {
  const live = await db
    .select({
      id: voiceSession.id,
      startedAt: voiceSession.startedAt,
      transcriberJobId: voiceSession.transcriberJobId,
      transcriberSeenAt: voiceSession.transcriberSeenAt,
    })
    .from(voiceSession)
    .where(and(isNull(voiceSession.endedAt), isNull(voiceSession.emptySince)))

  const dispatched: string[] = []
  const failed: SyncFailure[] = []
  for (const session of live) {
    try {
      const connected = await reconcileSession(config, session.id)
      if (connected > 0 && transcriberMissing(session)) {
        await dispatchTranscriber(config, session.id)
        dispatched.push(session.id)
      }
    } catch (err) {
      failed.push({ sessionId: session.id, err })
    }
  }
  return { checked: live.length, dispatched, failed }
}
