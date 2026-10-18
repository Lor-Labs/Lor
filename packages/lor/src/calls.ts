import {
  type AnyColumn,
  and,
  asc,
  cosineDistance,
  db,
  eq,
  gte,
  isNotNull,
  lt,
  schema,
  sql,
} from "@repo/db"
import { formatCallTime } from "@repo/realtime-types/call-transcript"
import { embedCallQuery } from "./embeddings"
import {
  type DbTransaction,
  fuseByRank,
  orTsQuery,
  privateAudienceFilter,
  withIterativeScan,
} from "./retrieval"

// Past voice calls for Lor (reference/voice-channels-runbook.md V7): search
// over voice_passage (topic sections and summaries of ended calls), reading
// the transcript around a hit, and resolving [[call:…]] citations. Scope is
// the run's channel audience, never the asker's access.

const POOL_FACTOR = 3
// A section can run for a whole topic; read_call returns the rest.
const SNIPPET_MAX = 1500
// One long call would otherwise fill every result slot.
const MAX_HITS_PER_CALL = 2
const READ_PAGE_LINES = 300

const { voicePassage, voiceSession } = schema

// Must match the voice_passage_text_tsv_idx expression exactly.
const passageTsv = sql`to_tsvector('english', ${voicePassage.context} || ' ' || ${voicePassage.text})`

// "4:05" or "1:04:05" to ms; plain digits are already ms (a citation that was
// grounded before). Null when it's neither.
export function parseCallTime(value: string) {
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  if (!/^\d{1,3}(:\d{2}){1,2}$/.test(trimmed)) return null
  const seconds = trimmed
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0)
  return seconds * 1000
}

function passages(executor: Pick<DbTransaction, "select"> = db) {
  return executor
    .select({
      id: voicePassage.id,
      sessionId: voicePassage.sessionId,
      kind: voicePassage.kind,
      startMs: voicePassage.startMs,
      endMs: voicePassage.endMs,
      context: voicePassage.context,
      text: voicePassage.text,
      channelName: schema.channel.name,
      startedAt: voiceSession.startedAt,
    })
    .from(voicePassage)
    .innerJoin(schema.channel, eq(voicePassage.channelId, schema.channel.id))
    .innerJoin(voiceSession, eq(voicePassage.sessionId, voiceSession.id))
    .$dynamic()
}

type Passage = Awaited<ReturnType<typeof passages>>[number]

// Keyword and vector results merge by reciprocal rank fusion, like
// attachment search: names and terms from the keyword side, paraphrases from
// the vector side.
export async function searchCalls(
  workspaceId: string,
  query: string,
  limit: number,
  privateContainerChannelId: string | null = null
) {
  const pool = limit * POOL_FACTOR
  const scope = and(
    eq(voicePassage.workspaceId, workspaceId),
    privateAudienceFilter(privateContainerChannelId)
  )
  const tsq = orTsQuery(query)
  const [keyword, vector] = await Promise.all([
    passages()
      .where(and(scope, sql`${passageTsv} @@ ${tsq}`))
      .orderBy(sql`ts_rank(${passageTsv}, ${tsq}) desc`)
      .limit(pool),
    embedCallQuery(query)
      .then((embedding) =>
        withIterativeScan((tx) =>
          passages(tx)
            .where(and(scope, isNotNull(voicePassage.embedding)))
            .orderBy(cosineDistance(voicePassage.embedding, embedding))
            .limit(pool)
        )
      )
      .catch(() => [] as Passage[]),
  ])

  const perCall = new Map<string, number>()
  return fuseByRank([keyword, vector], (row) => row.id)
    .filter((row) => {
      const hits = perCall.get(row.sessionId) ?? 0
      perCall.set(row.sessionId, hits + 1)
      return hits < MAX_HITS_PER_CALL
    })
    .slice(0, limit)
    .map((row) => ({
      sessionId: row.sessionId,
      kind: row.kind,
      channel: row.channelName,
      callStartedAt: row.startedAt.toISOString(),
      from: formatCallTime(row.startMs),
      to: formatCallTime(row.endMs),
      context: row.context,
      text: row.text.slice(0, SNIPPET_MAX),
      truncated: row.text.length > SNIPPET_MAX,
    }))
}

// An ended call in this workspace whose channel the run may read.
async function findReadableCall(
  workspaceId: string,
  sessionId: string,
  privateContainerChannelId: string | null
) {
  const [call] = await db
    .select({
      channelName: schema.channel.name,
      startedAt: voiceSession.startedAt,
      endedAt: voiceSession.endedAt,
    })
    .from(voiceSession)
    .innerJoin(schema.channel, eq(voiceSession.channelId, schema.channel.id))
    .where(
      and(
        eq(voiceSession.id, sessionId),
        eq(voiceSession.workspaceId, workspaceId),
        isNotNull(voiceSession.endedAt),
        privateAudienceFilter(privateContainerChannelId)
      )
    )
    .limit(1)
  return call?.endedAt ? { ...call, endedAt: call.endedAt } : null
}

// The transcript between two call times, gaps marked "not captured" as in
// the indexed passages. One page at a time; nextFrom continues.
export async function readCall(
  workspaceId: string,
  sessionId: string,
  privateContainerChannelId: string | null,
  range: { fromMs: number | null; toMs: number | null }
) {
  const call = await findReadableCall(
    workspaceId,
    sessionId,
    privateContainerChannelId
  )
  if (!call) return null
  const fromMs = range.fromMs ?? 0
  const within = (column: AnyColumn) =>
    and(
      gte(column, fromMs),
      range.toMs === null ? undefined : lt(column, range.toMs)
    )
  const [segments, gaps] = await Promise.all([
    db
      .select({
        startMs: schema.voiceTranscriptSegment.startMs,
        text: schema.voiceTranscriptSegment.text,
        speaker: schema.user.name,
      })
      .from(schema.voiceTranscriptSegment)
      .innerJoin(
        schema.voiceSessionParticipant,
        eq(
          schema.voiceSessionParticipant.id,
          schema.voiceTranscriptSegment.participantId
        )
      )
      .innerJoin(
        schema.user,
        eq(schema.user.id, schema.voiceSessionParticipant.userId)
      )
      .where(
        and(
          eq(schema.voiceTranscriptSegment.sessionId, sessionId),
          within(schema.voiceTranscriptSegment.startMs)
        )
      )
      .orderBy(asc(schema.voiceTranscriptSegment.startMs))
      .limit(READ_PAGE_LINES + 1),
    db
      .select({
        startMs: schema.voiceCaptureGap.startMs,
        endMs: schema.voiceCaptureGap.endMs,
        speaker: schema.user.name,
      })
      .from(schema.voiceCaptureGap)
      .leftJoin(
        schema.voiceSessionParticipant,
        eq(
          schema.voiceSessionParticipant.id,
          schema.voiceCaptureGap.participantId
        )
      )
      .leftJoin(
        schema.user,
        eq(schema.user.id, schema.voiceSessionParticipant.userId)
      )
      .where(
        and(
          eq(schema.voiceCaptureGap.sessionId, sessionId),
          within(schema.voiceCaptureGap.startMs)
        )
      ),
  ])
  const page = segments.slice(0, READ_PAGE_LINES)
  const next = segments[READ_PAGE_LINES]
  const lines = [
    ...page
      .filter((segment) => segment.text.trim())
      .map((segment) => ({
        at: segment.startMs,
        line: `[${formatCallTime(segment.startMs)}] ${segment.speaker}: ${segment.text}`,
      })),
    ...gaps
      .filter((gap) => !next || gap.startMs < next.startMs)
      .map((gap) => {
        const minutes = Math.max(
          1,
          Math.round((gap.endMs - gap.startMs) / 60_000)
        )
        const whose = gap.speaker ? `${gap.speaker}'s audio` : "Audio"
        return {
          at: gap.startMs,
          line: `[${formatCallTime(gap.startMs)}] (${whose} not captured for ${minutes} min)`,
        }
      }),
  ].sort((a, b) => a.at - b.at)
  return {
    channel: call.channelName,
    callStartedAt: call.startedAt.toISOString(),
    length: formatCallTime(call.endedAt.getTime() - call.startedAt.getTime()),
    lines: lines.map((entry) => entry.line),
    ...(next ? { nextFrom: formatCallTime(next.startMs) } : {}),
  }
}

// Workspace-scoped like message citations; opening the call checks access.
export async function resolveCallCitation(
  workspaceId: string,
  sessionId: string
) {
  const [call] = await db
    .select({
      channelName: schema.channel.name,
      startedAt: voiceSession.startedAt,
    })
    .from(voiceSession)
    .innerJoin(schema.channel, eq(voiceSession.channelId, schema.channel.id))
    .where(
      and(
        eq(voiceSession.id, sessionId),
        eq(voiceSession.workspaceId, workspaceId),
        isNotNull(voiceSession.endedAt)
      )
    )
    .limit(1)
  return call
    ? {
        channelName: call.channelName ?? "voice",
        startedAt: call.startedAt.toISOString(),
      }
    : null
}
