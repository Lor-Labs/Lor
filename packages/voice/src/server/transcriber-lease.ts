import { and, db, eq, isNull, schema } from "@repo/db"

const { voiceCaptureGap, voiceSession } = schema

export const TRANSCRIBER_HEARTBEAT_MS = 30_000
// Three missed heartbeats.
const TRANSCRIBER_STALE_MS = 90_000

type Lease = {
  startedAt: Date
  transcriberJobId: string | null
  transcriberSeenAt: Date | null
}

// No transcriber renewed the lease recently: it never joined, it died, or it
// left an empty room that has people again.
export function transcriberMissing(lease: Lease, now = new Date()) {
  const seenAt = lease.transcriberSeenAt ?? lease.startedAt
  return now.getTime() - seenAt.getTime() > TRANSCRIBER_STALE_MS
}

// Where capture stopped, or null when nothing was missed. A lease released
// because the room emptied missed nothing; a held one means its holder died
// with people still in the call.
function missedSince(lease: Lease) {
  if (!lease.transcriberSeenAt) return lease.startedAt
  return lease.transcriberJobId ? lease.transcriberSeenAt : null
}

function gapRow(sessionId: string, lease: Lease, since: Date, until: Date) {
  const offset = (at: Date) => at.getTime() - lease.startedAt.getTime()
  return {
    sessionId,
    participantId: null,
    startMs: offset(since),
    endMs: offset(until),
    reason: "no_transcriber" as const,
  }
}

// Returns null when the session has ended or another live transcriber holds
// the lease; the caller should leave the room. Taking over records the
// stretch nobody transcribed.
export async function claimTranscriber(sessionId: string, jobId: string) {
  return db.transaction(async (tx) => {
    const [lease] = await tx
      .select({
        startedAt: voiceSession.startedAt,
        transcriberJobId: voiceSession.transcriberJobId,
        transcriberSeenAt: voiceSession.transcriberSeenAt,
      })
      .from(voiceSession)
      .where(and(eq(voiceSession.id, sessionId), isNull(voiceSession.endedAt)))
      .for("update")
    if (!lease) return null

    const now = new Date()
    const heldByOther =
      lease.transcriberJobId !== null &&
      lease.transcriberJobId !== jobId &&
      !transcriberMissing(lease, now)
    if (heldByOther) return null

    // The threshold skips the normal dispatch delay at call start.
    const since = missedSince(lease)
    if (since && now.getTime() - since.getTime() > TRANSCRIBER_STALE_MS) {
      await tx
        .insert(voiceCaptureGap)
        .values(gapRow(sessionId, lease, since, now))
    }
    await tx
      .update(voiceSession)
      .set({ transcriberJobId: jobId, transcriberSeenAt: now })
      .where(eq(voiceSession.id, sessionId))
    return { startedAt: lease.startedAt }
  })
}

// False once another transcriber has taken the lease.
export async function renewTranscriber(sessionId: string, jobId: string) {
  const rows = await db
    .update(voiceSession)
    .set({ transcriberSeenAt: new Date() })
    .where(
      and(
        eq(voiceSession.id, sessionId),
        eq(voiceSession.transcriberJobId, jobId)
      )
    )
    .returning({ id: voiceSession.id })
  return rows.length > 0
}

// The room emptied, so a missing transcriber from here on misses nothing.
export async function releaseTranscriber(sessionId: string, jobId: string) {
  await db
    .update(voiceSession)
    .set({ transcriberJobId: null, transcriberSeenAt: new Date() })
    .where(
      and(
        eq(voiceSession.id, sessionId),
        eq(voiceSession.transcriberJobId, jobId)
      )
    )
}

// At session end: a call that lost its transcriber, or never had one, and
// got none before it ended.
export async function recordMissedTranscriberAtEnd(
  session: Lease & { id: string; endedAt: Date }
) {
  const since = missedSince(session)
  if (!since || since >= session.endedAt) return
  await db
    .insert(voiceCaptureGap)
    .values(gapRow(session.id, session, since, session.endedAt))
}
