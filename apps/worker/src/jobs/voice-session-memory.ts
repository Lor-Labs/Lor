import { recordUsage } from "@repo/billing"
import { embedDocumentsWithUsage, summarizeCall } from "@repo/lor"
import { formatCallTime } from "@repo/realtime-types/call-transcript"
import {
  buildSectionPassages,
  callDateLabel,
  callWordCount,
  listUnprocessedCalls,
  loadEndedCall,
  notifyVoicePresence,
  numberedCallTranscript,
  saveCallMemory,
  summaryPassageContext,
  summaryText,
} from "@repo/voice/server"
import { logger } from "@/lib/logger"
import { enqueueCallMemory } from "@/lib/voice-queue"

// Calls shorter than this, or with almost nothing said, are left alone: no
// summary, no index.
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

// Summarizes an ended call and indexes it for Lor's search (a summary passage
// plus one passage per topic section, each labelled with where it sits). The
// summary shows on the call's Summary tab, never in its chat
// (reference/workspace-model.md, decision 3).
export async function processCallMemory(sessionId: string) {
  const call = await loadEndedCall(sessionId)
  if (!call) return
  const onUsage = (usage: Parameters<typeof recordUsage>[0]) =>
    void recordUsage(usage, { channelId: call.channelId })

  const durationMs = call.endedAt.getTime() - call.startedAt.getTime()
  if (durationMs < MIN_CALL_MS || callWordCount(call.lines) < MIN_CALL_WORDS) {
    await saveCallMemory(sessionId, { summary: null, passages: [] })
    notifyVoicePresence(call.workspaceId)
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
  // Past-call lists and open Summary tabs refetch.
  notifyVoicePresence(call.workspaceId)
  logger.info(
    { sessionId, passages: rows.length, summarized: summary !== null },
    "Call memory saved"
  )
}
