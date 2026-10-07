import { and, asc, db, eq, gt, schema } from "@repo/db"
import { formatSpeakerLine, type ModelMessage } from "@repo/lor"
import { listCallLines, listRunVoiceRequestSpans } from "@repo/voice/server"
import { logger } from "@/lib/logger"
import {
  type Continuation,
  findPredecessor,
  replayChain,
} from "@/lib/run-continuation"

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

// A later request in a call continues the call's last run: its transcript
// (earlier requests, tool results, what Lor showed) replayed verbatim, plus
// one message with what was said since and the new request. Keeps the cached
// prompt prefix across the call. Null falls back to a fresh snapshot.
export async function buildVoiceContinuation(
  request: VoiceRequestTurn,
  runId: string
): Promise<Continuation | null> {
  try {
    const predecessor = await findPredecessor({
      scopeKey: request.sessionId,
      channelId: request.channelId,
      excludeRunId: runId,
    })
    if (!predecessor?.context) return null
    if (predecessor.stopReason === "awaiting_approval") return null
    const replayed = await replayChain(predecessor.id)
    if (!replayed) return null
    const said = await loadVoiceDelta(request, {
      id: predecessor.id,
      startedAt: predecessor.startedAt ?? predecessor.createdAt,
    })
    if (!said) return null
    const deltaText = formatVoiceDelta(said, request)
    return {
      predecessorRunId: predecessor.id,
      messages: [
        ...replayed.messages,
        { role: "user", content: deltaText } satisfies ModelMessage,
      ],
      conversation: [
        { authorName: request.speakerName, content: request.content },
      ],
      coveredMessageIds: [],
      deltaText,
      approvalResume: null,
      lastInputTokens: replayed.lastInputTokens,
      compaction: replayed.compaction,
    }
  } catch (err) {
    logger.warn(
      { err, sessionId: request.sessionId },
      "Voice run continuation failed; falling back to a fresh context"
    )
    return null
  }
}
