import { and, asc, db, eq, isNotNull, isNull, type SQL, schema } from "@repo/db"
import type { NewVoicePassage, VoiceSessionSummary } from "@repo/db/schema"
import { formatCallTime } from "@repo/realtime-types/call-transcript"

const {
  agentRun,
  channel,
  message,
  user,
  voiceCaptureGap,
  voicePassage,
  voiceSession,
  voiceSessionParticipant,
  voiceTranscriptSegment,
} = schema

// A topic section is one passage. Only a section too long for one embedding
// input (alibaba/qwen3-embedding-4b takes 32K tokens) is cut, at line
// boundaries; each part keeps the section's title and description.
const MAX_PASSAGE_CHARS = 80_000

export type CallLine =
  | {
      kind: "speech"
      startMs: number
      endMs: number
      speaker: string
      text: string
    }
  | { kind: "gap"; startMs: number; endMs: number; speaker: string | null }

// A topic of the call, as the summary model divided it.
export type CallSectionInput = {
  startLine: number
  title: string
  about: string
}

export type CallPassage = {
  startMs: number
  endMs: number
  speakers: string[]
  title: string
  about: string
  text: string
}

// Ended calls whose after-call job never ran (e.g. the queue was down when
// they ended), oldest first. A backstop: the job is queued at the end.
export async function listUnprocessedCalls(limit: number) {
  return await db
    .select({ id: voiceSession.id })
    .from(voiceSession)
    .where(
      and(
        isNotNull(voiceSession.endedAt),
        isNull(voiceSession.memoryProcessedAt)
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
      threadRootId: voiceSession.threadRootId,
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

// The transcript as the summary model reads it: "L12 [4:05] Alice: …", the
// L numbers being what its sections point at.
export function numberedCallTranscript(lines: CallLine[]) {
  return lines
    .map((line, index) => `L${index} ${renderCallLine(line)}`)
    .join("\n")
}

function toPassage(
  lines: CallLine[],
  section: Pick<CallPassage, "title" | "about">
): CallPassage | null {
  const first = lines[0]
  const last = lines.at(-1)
  if (!first || !last || callWordCount(lines) === 0) return null
  return {
    ...section,
    startMs: first.startMs,
    endMs: last.endMs,
    speakers: [
      ...new Set(
        lines.flatMap((line) => (line.kind === "speech" ? [line.speaker] : []))
      ),
    ],
    text: lines.map(renderCallLine).join("\n"),
  }
}

// One passage per topic section. Bad section starts are dropped, and the
// first always starts at the top; no sections at all means one section for
// the whole call.
export function buildSectionPassages(
  lines: CallLine[],
  sections: CallSectionInput[] | null
): CallPassage[] {
  const starts = (sections ?? [])
    .filter((section) => section.startLine < lines.length)
    .sort((a, b) => a.startLine - b.startLine)
    .filter(
      (section, index, all) =>
        index === 0 || section.startLine !== all[index - 1]?.startLine
    )
  const normalized = starts.length > 0 ? starts : [{ title: "", about: "" }]
  return normalized.flatMap((section, index) => {
    const from = index === 0 ? 0 : (starts[index]?.startLine ?? 0)
    const to = starts[index + 1]?.startLine ?? lines.length
    const sectionLines = lines.slice(from, to)
    const label = { title: section.title, about: section.about }
    const parts: CallLine[][] = [[]]
    let chars = 0
    for (const line of sectionLines) {
      const length = renderCallLine(line).length + 1
      if (chars + length > MAX_PASSAGE_CHARS && parts.at(-1)?.length) {
        parts.push([])
        chars = 0
      }
      parts.at(-1)?.push(line)
      chars += length
    }
    return parts.flatMap((part) => toPassage(part, label) ?? [])
  })
}

// Replaces the call's summary and passages in one go and marks it processed;
// re-running rebuilds the same rows.
// "Oct 5, 2026", as passages label the call.
export function callDateLabel(startedAt: Date) {
  return startedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

// The summary as text, for its search passage.
export function summaryText(summary: VoiceSessionSummary) {
  const section = (title: string, lines: string[]) =>
    lines.length > 0
      ? `${title}\n${lines.map((line) => `- ${line}`).join("\n")}`
      : ""
  return [
    summary.title,
    summary.summary,
    section(
      "Decisions",
      summary.decisions.map((item) => item.text)
    ),
    section(
      "Open questions",
      summary.openQuestions.map((item) => item.text)
    ),
    section(
      "Action items",
      summary.actionItems.map((item) =>
        [item.owner ? `${item.owner}: ${item.title}` : item.title, item.detail]
          .filter(Boolean)
          .join(". ")
      )
    ),
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function summaryPassageContext(
  channelName: string,
  date: string,
  speakers: string[]
) {
  return `Summary of a call in #${channelName} on ${date}. Speakers: ${speakers.join(", ")}.`
}

// A call's summary, who last corrected it, and whether the after-call job has
// run (a processed call with no summary was too short, or Lor failed).
async function loadSummaryWhere(where: SQL) {
  const [row] = await db
    .select({
      sessionId: voiceSession.id,
      channelId: voiceSession.channelId,
      summary: voiceSession.summary,
      processedAt: voiceSession.memoryProcessedAt,
      editedAt: voiceSession.summaryEditedAt,
      editorId: user.id,
      editorName: user.name,
    })
    .from(voiceSession)
    .leftJoin(user, eq(user.id, voiceSession.summaryEditedById))
    .where(where)
    .limit(1)
  return row ?? null
}

export type CallSummaryRow = NonNullable<
  Awaited<ReturnType<typeof loadSummaryWhere>>
>

export function loadCallSummary(sessionId: string) {
  return loadSummaryWhere(eq(voiceSession.id, sessionId))
}

// Old calls' summary cards in the call chat, which phones still render.
export function loadSummaryCard(messageId: string) {
  return loadSummaryWhere(eq(voiceSession.summaryCardMessageId, messageId))
}

// The search passage for a corrected summary, labelled like the one the
// after-call job wrote. Speakers are the people heard in the transcript.
export async function summaryPassageFor(
  sessionId: string,
  summary: VoiceSessionSummary
) {
  const [call] = await db
    .select({
      workspaceId: voiceSession.workspaceId,
      channelId: voiceSession.channelId,
      channelName: channel.name,
      startedAt: voiceSession.startedAt,
      endedAt: voiceSession.endedAt,
    })
    .from(voiceSession)
    .innerJoin(channel, eq(channel.id, voiceSession.channelId))
    .where(eq(voiceSession.id, sessionId))
    .limit(1)
  if (!call?.endedAt) return null
  const speakers = await db
    .selectDistinct({ name: user.name })
    .from(voiceTranscriptSegment)
    .innerJoin(
      voiceSessionParticipant,
      eq(voiceSessionParticipant.id, voiceTranscriptSegment.participantId)
    )
    .innerJoin(user, eq(user.id, voiceSessionParticipant.userId))
    .where(eq(voiceTranscriptSegment.sessionId, sessionId))
  return {
    workspaceId: call.workspaceId,
    channelId: call.channelId,
    startMs: 0,
    endMs: call.endedAt.getTime() - call.startedAt.getTime(),
    context: summaryPassageContext(
      call.channelName ?? "voice",
      callDateLabel(call.startedAt),
      speakers.map((speaker) => speaker.name)
    ),
    text: summaryText(summary),
  }
}

// The summary and its search passage change together, so Lor never cites
// the version that was corrected.
export async function saveEditedSummary(
  sessionId: string,
  edit: {
    summary: VoiceSessionSummary
    editedById: string
    passage: Omit<NewVoicePassage, "id" | "createdAt" | "sessionId" | "kind">
  }
) {
  await db.transaction(async (tx) => {
    await tx
      .delete(voicePassage)
      .where(
        and(
          eq(voicePassage.sessionId, sessionId),
          eq(voicePassage.kind, "summary")
        )
      )
    await tx
      .insert(voicePassage)
      .values({ ...edit.passage, sessionId, kind: "summary" })
    await tx
      .update(voiceSession)
      .set({
        summary: edit.summary,
        summaryEditedAt: new Date(),
        summaryEditedById: edit.editedById,
      })
      .where(eq(voiceSession.id, sessionId))
  })
}

// Deletes an ended call and everything derived from it: Lor's runs in the
// call (each holds the transcript up to its request), the call chat (its root
// message, so every reply and Lor's summary card go with it), and the session
// row, which cascades to participants, transcript, capture gaps, Lor's
// requests, and search passages. Memory pages Lor wrote from the call stay;
// nothing records which sentences came from it.
export async function deleteCall(sessionId: string) {
  return await db.transaction(async (tx) => {
    const [session] = await tx
      .select({ threadRootId: voiceSession.threadRootId })
      .from(voiceSession)
      .where(eq(voiceSession.id, sessionId))
      .limit(1)
    if (!session) return null
    // Voice runs are scoped to their call (scopeKey = session id).
    await tx.delete(agentRun).where(eq(agentRun.scopeKey, sessionId))
    await tx.delete(voiceSession).where(eq(voiceSession.id, sessionId))
    if (session.threadRootId) {
      await tx.delete(message).where(eq(message.id, session.threadRootId))
    }
    return { threadRootId: session.threadRootId }
  })
}

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
