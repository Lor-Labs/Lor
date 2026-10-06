import { recordUsage } from "@repo/billing"
import type { VoiceSessionSummary } from "@repo/db/schema"
import { embedDocumentsWithUsage, summarizeCall } from "@repo/lor"
import {
  buildSectionPassages,
  callDateLabel,
  callWordCount,
  formatCallTime,
  listUnprocessedCalls,
  loadEndedCall,
  numberedCallTranscript,
  saveCallMemory,
  summaryPassageContext,
  summaryText,
} from "@repo/voice/server"
import { logger } from "@/lib/logger"
import { type LorMessageDeps, postLorMessage } from "@/lib/lor-messages"
import { enqueueCallMemory } from "@/lib/voice-queue"

// Calls shorter than this, or with almost nothing said, are left alone: no
// summary, no index, no message.
const MIN_CALL_MS = 2 * 60_000
const MIN_CALL_WORDS = 40
const EMBED_BATCH = 32
const BACKSTOP_LIMIT = 20

// Run from the voice audit: calls whose job was never queued when they ended.
export async function queueMissedCallMemory() {
  for (const { id } of await listUnprocessedCalls(BACKSTOP_LIMIT)) {
    await enqueueCallMemory(id)
  }
}

// Tells everyone in the call what Lor did with it, so it never comes as a
// surprise. Posted in the call chat as Lor, so people in the call are
// notified the way a reply notifies them.
function recapMessage(summary: VoiceSessionSummary | null) {
  const indexed =
    "I indexed this call's transcript, so you can ask me about it later."
  return summary
    ? `${summaryText(summary)}\n\n${indexed}`
    : `${indexed} I couldn't write a summary this time.`
}

// Summarizes an ended call, indexes it for Lor's search (a summary passage
// plus one passage per topic section, each labelled with where it sits), and
// posts the recap in the call chat.
export async function processCallMemory(
  sessionId: string,
  deps: LorMessageDeps
) {
  const call = await loadEndedCall(sessionId)
  if (!call) return
  const onUsage = (usage: Parameters<typeof recordUsage>[0]) =>
    void recordUsage(usage, { channelId: call.channelId })

  const durationMs = call.endedAt.getTime() - call.startedAt.getTime()
  if (durationMs < MIN_CALL_MS || callWordCount(call.lines) < MIN_CALL_WORDS) {
    await saveCallMemory(sessionId, { summary: null, passages: [] })
    return
  }

  const channelName = call.channelName ?? "voice"
  const date = callDateLabel(call.startedAt)
  const speakers = [
    ...new Set(
      call.lines.flatMap((line) =>
        line.kind === "speech" ? [line.speaker] : []
      )
    ),
  ]
  const memory = await summarizeCall(
    {
      workspaceId: call.workspaceId,
      channelName,
      date,
      speakers,
      transcript: numberedCallTranscript(call.lines),
    },
    onUsage
  )
  const summary = memory?.summary ?? null
  const callLabel = `Call in #${channelName} on ${date}`
  const rows = [
    ...(summary
      ? [
          {
            kind: "summary" as const,
            startMs: 0,
            endMs: durationMs,
            context: summaryPassageContext(channelName, date, speakers),
            text: summaryText(summary),
          },
        ]
      : []),
    ...buildSectionPassages(call.lines, memory?.sections ?? null).map(
      (passage) => ({
        kind: "transcript" as const,
        startMs: passage.startMs,
        endMs: passage.endMs,
        context: [
          `${callLabel}, ${formatCallTime(passage.startMs)}–${formatCallTime(passage.endMs)} into the call. Speakers: ${passage.speakers.join(", ")}.`,
          passage.title && `Topic: ${passage.title}. ${passage.about}`,
        ]
          .filter(Boolean)
          .join(" "),
        text: passage.text,
      })
    ),
  ]

  // A failed batch keeps its rows without vectors: still found by keyword.
  const embeddings: (number[] | null)[] = []
  for (let start = 0; start < rows.length; start += EMBED_BATCH) {
    const batch = rows.slice(start, start + EMBED_BATCH)
    try {
      const result = await embedDocumentsWithUsage(
        batch.map((row) => `${row.context}\n${row.text}`)
      )
      onUsage({
        workspaceId: call.workspaceId,
        tool: "voice.embed",
        model: result.model,
        inputTokens: result.tokens,
      })
      embeddings.push(...result.embeddings)
    } catch (err) {
      logger.warn({ err, sessionId }, "Call passage embed batch failed")
      embeddings.push(...batch.map(() => null))
    }
  }

  await saveCallMemory(sessionId, {
    summary,
    passages: rows.map((row, index) => ({
      ...row,
      workspaceId: call.workspaceId,
      channelId: call.channelId,
      embedding: embeddings[index] ?? null,
    })),
  })
  // After the save: a retry never posts twice, at the cost of a lost recap
  // if this post fails.
  if (call.threadRootId) {
    await postLorMessage(deps, {
      channelId: call.channelId,
      threadRootId: call.threadRootId,
      content: recapMessage(summary),
    }).catch((err) =>
      logger.error({ err, sessionId }, "Call recap post failed")
    )
  }
  logger.info(
    { sessionId, passages: rows.length, summarized: summary !== null },
    "Call memory saved"
  )
}
