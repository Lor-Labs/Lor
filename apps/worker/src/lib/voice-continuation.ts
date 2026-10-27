import { and, asc, db, eq, gt, schema } from "@repo/db"
import { formatSpeakerLine } from "@repo/lor"
import { listCallLines, listRunVoiceRequestSpans } from "@repo/voice/server"
import { loadPredecessorRun } from "@/lib/run-continuation"

// Runaway guards, not windows: everything said since the last run goes in.
const MAX_DELTA_LINES = 5_000
const MAX_DELTA_CHAT = 1_000

type VoiceRequestTurn = {
  sessionId: string
  channelId: string
  threadRootId: string | null
  sessionStartedAt: Date
  startMs: number
  speakerName: string
  // What Lor hears for the request, as the fresh path would put it.
  content: string
}

// What was said in the call since the predecessor run started: transcript
// lines from its first request on, minus the words of requests Lor already
// took on, plus the call chat sent since it started.
async function loadVoiceDelta(
  request: VoiceRequestTurn,
  predecessor: { id: string; startedAt: Date }
) {
  const spans = await listRunVoiceRequestSpans(request.sessionId)
  const fromMs = Math.min(
    ...spans
      .filter((span) => span.runId === predecessor.id)
      .map((span) => span.startMs)
  )
  if (!Number.isFinite(fromMs)) return null
  const startedAt = request.sessionStartedAt.getTime()
  const [lines, chat] = await Promise.all([
    listCallLines(request.sessionId, {
      fromMs,
      untilMs: request.startMs,
      limit: MAX_DELTA_LINES,
    }),
    request.threadRootId
      ? db
          .select({
            content: schema.message.content,
            createdAt: schema.message.createdAt,
            authorName: schema.user.name,
          })
          .from(schema.message)
          .innerJoin(schema.user, eq(schema.user.id, schema.message.authorId))
          .where(
            and(
              eq(schema.message.threadRootId, request.threadRootId),
              gt(schema.message.createdAt, predecessor.startedAt)
            )
          )
          .orderBy(asc(schema.message.createdAt))
          .limit(MAX_DELTA_CHAT)
      : [],
  ])
  return [
    ...lines
      .filter(
        (line) =>
          !spans.some(
            (span) => line.startMs >= span.startMs && line.startMs <= span.endMs
          )
      )
      .map((line) => ({
        at: startedAt + line.startMs,
        text: formatSpeakerLine(line.speakerName, line.text),
      })),
    ...chat.flatMap((message) =>
      message.content
        ? [
            {
              at: message.createdAt.getTime(),
              text: formatSpeakerLine(
                message.authorName,
                `[call chat] ${message.content}`
              ),
            },
          ]
        : []
    ),
  ]
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.text)
}

function formatVoiceDelta(said: string[], request: VoiceRequestTurn) {
  const since =
    said.length > 0
      ? `\n\nSaid in the call since then:\n${said.join("\n")}`
      : ""
  return `The call continued since you last worked. Everything above is still your context.${since}\n\nNew request:\n${formatSpeakerLine(request.speakerName, request.content)}`
}

// The prompt of a later request in a call: what was said since the run that
// saved the call's Pi conversation last, then the new request. Pi's saved
// state holds the earlier requests, tool results and what Lor showed.
export async function buildVoiceDelta(
  request: VoiceRequestTurn,
  predecessorRunId: string | null
): Promise<string> {
  const predecessor = await loadPredecessorRun(predecessorRunId)
  const said = await loadVoiceDelta(request, {
    id: predecessor.id,
    startedAt: predecessor.startedAt ?? predecessor.createdAt,
  })
  return formatVoiceDelta(said ?? [], request)
}
