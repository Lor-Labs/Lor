import { and, db, eq, isNotNull, isNull, lte, schema } from "@repo/db"
import { TwirpError } from "livekit-server-sdk"
import { VOICE_SESSION_GRACE_MS } from "../index"
import { getRoomService, type LiveKitConfig } from "./livekit"
import { notifyVoicePresence } from "./notify"
import { markParticipantConnected, markParticipantLeft } from "./participants"

const { voiceSession, voiceSessionParticipant } = schema

type SyncFailure = { sessionId: string; err: unknown }

async function listRoomIdentities(config: LiveKitConfig, sessionId: string) {
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
    if (err instanceof TwirpError && err.status === 404) return new Map()
    throw err
  }
}

// Makes the database match who LiveKit says is in the room, and returns how
// many of the session's participants are connected.
export async function reconcileSession(
  config: LiveKitConfig,
  sessionId: string
) {
  const inRoom = await listRoomIdentities(config, sessionId)
  const rows = await db
    .select({
      id: voiceSessionParticipant.id,
      connectedAt: voiceSessionParticipant.connectedAt,
    })
    .from(voiceSessionParticipant)
    .where(eq(voiceSessionParticipant.sessionId, sessionId))

  let connected = 0
  for (const row of rows) {
    const joinedAt = inRoom.get(row.id)
    if (joinedAt) {
      connected += 1
      if (!row.connectedAt) {
        await markParticipantConnected(sessionId, row.id, joinedAt)
      }
    } else if (row.connectedAt) {
      await markParticipantLeft(sessionId, { participantId: row.id })
    }
  }
  return connected
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
      // Compare-and-set: a rejoin since the read resets emptySince and wins.
      const [row] = await db
        .update(voiceSession)
        .set({ endedAt: emptySince })
        .where(
          and(
            eq(voiceSession.id, id),
            isNull(voiceSession.endedAt),
            eq(voiceSession.emptySince, emptySince)
          )
        )
        .returning({
          id: voiceSession.id,
          workspaceId: voiceSession.workspaceId,
        })
      if (row) {
        ended.push(row.id)
        // Lets open voice channel pages move the session into history.
        notifyVoicePresence(row.workspaceId)
      }
    } catch (err) {
      failed.push({ sessionId: id, err })
    }
  }
  return { ended, failed }
}

// Every 10 minutes. Catches missed "left" webhooks on sessions the database
// still thinks are occupied.
export async function auditLiveSessions(config: LiveKitConfig) {
  const live = await db
    .select({ id: voiceSession.id })
    .from(voiceSession)
    .where(and(isNull(voiceSession.endedAt), isNull(voiceSession.emptySince)))

  const failed: SyncFailure[] = []
  for (const { id } of live) {
    try {
      await reconcileSession(config, id)
    } catch (err) {
      failed.push({ sessionId: id, err })
    }
  }
  return { checked: live.length, failed }
}
