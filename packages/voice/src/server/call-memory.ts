import { and, asc, db, eq, isNotNull, isNull, lt, schema } from "@repo/db"
import type { NewVoicePassage, VoiceSessionSummary } from "@repo/db/schema"

const {
  channel,
  user,
  voiceCaptureGap,
  voicePassage,
  voiceSession,
  voiceSessionParticipant,
  voiceTranscriptSegment,
} = schema

// Ended calls are processed once the session settles.
const SETTLE_MS = 30_000

// A passage is a stretch of back-and-forth, not a single turn: most turns are
// a few words and say nothing alone. It closes near TARGET_WORDS, at a long
// pause once it has MIN_WORDS, or at MAX_SPAN_MS; the next one repeats the
// last short line so an exchange isn't cut in half.
const TARGET_WORDS = 300
const MIN_WORDS = 80
const PAUSE_BREAK_MS = 20_000
const MAX_SPAN_MS = 150_000
const OVERLAP_MAX_WORDS = 60

export type CallLine =
  | {
      kind: "speech"
      startMs: number
      endMs: number
      speaker: string
      text: string
    }
  | { kind: "gap"; startMs: number; endMs: number; speaker: string | null }

export type CallPassage = {
  startMs: number
  endMs: number
  speakers: string[]
  text: string
}

// Ended calls not yet summarized and indexed, oldest first.
export async function listUnprocessedCalls(limit: number) {
  return await db
    .select({ id: voiceSession.id })
    .from(voiceSession)
    .where(
      and(
        isNotNull(voiceSession.endedAt),
        isNull(voiceSession.memoryProcessedAt),
        lt(voiceSession.endedAt, new Date(Date.now() - SETTLE_MS))
      )
    )
    .orderBy(asc(voiceSession.endedAt))
    .limit(limit)
}

// An ended call's transcript and capture gaps in time order, with names.
export async function loadEndedCall(sessionId: string) {
  const [session] = await db
    .select({
      id: voiceSession.id,
      workspaceId: voiceSession.workspaceId,
      channelId: voiceSession.channelId,
      channelName: channel.name,
      startedAt: voiceSession.startedAt,
      endedAt: voiceSession.endedAt,
      memoryProcessedAt: voiceSession.memoryProcessedAt,
    })
    .from(voiceSession)
    .innerJoin(channel, eq(channel.id, voiceSession.channelId))
    .where(eq(voiceSession.id, sessionId))
    .limit(1)
  if (!session?.endedAt || session.memoryProcessedAt) return null

  const [segments, gaps] = await Promise.all([
    db
      .select({
        startMs: voiceTranscriptSegment.startMs,
        endMs: voiceTranscriptSegment.endMs,
        text: voiceTranscriptSegment.text,
        speaker: user.name,
      })
      .from(voiceTranscriptSegment)
      .innerJoin(
        voiceSessionParticipant,
        eq(voiceSessionParticipant.id, voiceTranscriptSegment.participantId)
      )
      .innerJoin(user, eq(user.id, voiceSessionParticipant.userId))
      .where(eq(voiceTranscriptSegment.sessionId, sessionId))
      .orderBy(asc(voiceTranscriptSegment.startMs)),
    db
      .select({
        startMs: voiceCaptureGap.startMs,
        endMs: voiceCaptureGap.endMs,
        speaker: user.name,
      })
      .from(voiceCaptureGap)
      .leftJoin(
        voiceSessionParticipant,
        eq(voiceSessionParticipant.id, voiceCaptureGap.participantId)
      )
      .leftJoin(user, eq(user.id, voiceSessionParticipant.userId))
      .where(eq(voiceCaptureGap.sessionId, sessionId)),
  ])
  const lines: CallLine[] = [
    ...segments
      .filter((segment) => segment.text.trim())
      .map((segment) => ({ kind: "speech" as const, ...segment })),
    ...gaps.map((gap) => ({ kind: "gap" as const, ...gap })),
  ].sort((a, b) => a.startMs - b.startMs)
  return { ...session, endedAt: session.endedAt, lines }
}

// "4:05", or "1:04:05" past an hour, from the call's start.
export function formatCallTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, "0")
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`
}

// "[4:05] Alice: …", with gaps as "not captured" so nothing is read into them.
export function renderCallLine(line: CallLine) {
  const at = `[${formatCallTime(line.startMs)}]`
  if (line.kind === "speech") return `${at} ${line.speaker}: ${line.text}`
  const minutes = Math.max(1, Math.round((line.endMs - line.startMs) / 60_000))
  const whose = line.speaker ? `${line.speaker}'s audio` : "Audio"
  return `${at} (${whose} not captured for ${minutes} min)`
}

const wordCount = (line: CallLine) =>
  line.kind === "speech" ? line.text.split(/\s+/).length : 0

export function callWordCount(lines: CallLine[]) {
  return lines.reduce((sum, line) => sum + wordCount(line), 0)
}

export function splitCallPassages(lines: CallLine[]): CallPassage[] {
  const passages: CallPassage[] = []
  let current: CallLine[] = []
  let words = 0
  const close = () => {
    const first = current[0]
    const last = current.at(-1)
    if (!first || !last || words === 0) return
    passages.push({
      startMs: first.startMs,
      endMs: last.endMs,
      speakers: [
        ...new Set(
          current.flatMap((line) =>
            line.kind === "speech" ? [line.speaker] : []
          )
        ),
      ],
      text: current.map(renderCallLine).join("\n"),
    })
    const carry = last.kind === "speech" && wordCount(last) <= OVERLAP_MAX_WORDS
    current = carry ? [last] : []
    words = carry ? wordCount(last) : 0
  }
  for (const line of lines) {
    const previous = current.at(-1)
    const paused =
      previous !== undefined && line.startMs - previous.endMs > PAUSE_BREAK_MS
    const first = current[0]
    const long = first !== undefined && line.endMs - first.startMs > MAX_SPAN_MS
    if (words >= TARGET_WORDS || (paused && words >= MIN_WORDS) || long) {
      close()
    }
    current.push(line)
    words += wordCount(line)
  }
  close()
  return passages
}

// Replaces the call's summary and passages in one go and marks it processed;
// re-running rebuilds the same rows.
export async function saveCallMemory(
  sessionId: string,
  memory: {
    summary: VoiceSessionSummary | null
    passages: Omit<NewVoicePassage, "id" | "createdAt" | "sessionId">[]
  }
) {
  await db.transaction(async (tx) => {
    await tx.delete(voicePassage).where(eq(voicePassage.sessionId, sessionId))
    if (memory.passages.length > 0) {
      await tx
        .insert(voicePassage)
        .values(memory.passages.map((passage) => ({ ...passage, sessionId })))
    }
    await tx
      .update(voiceSession)
      .set({ summary: memory.summary, memoryProcessedAt: new Date() })
      .where(eq(voiceSession.id, sessionId))
  })
}
