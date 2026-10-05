import { recordUsage } from "@repo/billing"
import type { VoiceSessionSummary } from "@repo/db/schema"
import {
  embedDocumentsWithUsage,
  situateCallPassages,
  summarizeCall,
} from "@repo/lor"
import { VOICE_SESSION_MEMORY_JOB } from "@repo/realtime-types/queues"
import {
  callWordCount,
  formatCallTime,
  listUnprocessedCalls,
  loadEndedCall,
  renderCallLine,
  saveCallMemory,
  splitCallPassages,
} from "@repo/voice/server"
import { logger } from "@/lib/logger"
import { getVoiceQueue } from "@/lib/voice-queue"

// Calls shorter than this, or with almost nothing said, get no summary and
// no passages.
const MIN_CALL_MS = 2 * 60_000
const MIN_CALL_WORDS = 40
const EMBED_BATCH = 32
const SWEEP_LIMIT = 20
export const ENDED_CALL_SWEEP_EVERY_MS = 60_000

// Maintenance sweep: hands each ended, unprocessed call to the voice queue,
// which runs several at once (the maintenance worker runs one job at a time).
// The fixed job id keeps a call from being queued twice.
export async function sweepEndedCalls() {
  for (const { id } of await listUnprocessedCalls(SWEEP_LIMIT)) {
    await getVoiceQueue().add(
      VOICE_SESSION_MEMORY_JOB,
      { sessionId: id },
      {
        jobId: `memory-${id}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: { age: 86_400 },
      }
    )
  }
}

function summaryText(summary: VoiceSessionSummary) {
  const section = (title: string, items: VoiceSessionSummary["decisions"]) =>
    items.length > 0
      ? `${title}:\n${items.map((item) => `- ${item.text}`).join("\n")}`
      : ""
  return [
    summary.summary,
    section("Decisions", summary.decisions),
    section("Open questions", summary.openQuestions),
    section("Follow-ups", summary.followUps),
  ]
    .filter(Boolean)
    .join("\n\n")
}

// Summarizes an ended call and indexes it for Lor's search: a summary
// passage plus transcript passages, each with context saying where it sits.
export async function processCallMemory(sessionId: string) {
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
  const date = call.startedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const speakers = [
    ...new Set(
      call.lines.flatMap((line) =>
        line.kind === "speech" ? [line.speaker] : []
      )
    ),
  ]
  const summary = await summarizeCall(
    {
      workspaceId: call.workspaceId,
      channelName,
      date,
      speakers,
      transcript: call.lines.map(renderCallLine).join("\n"),
    },
    onUsage
  )

  const passages = splitCallPassages(call.lines)
  const situated = summary
    ? await situateCallPassages(
        {
          workspaceId: call.workspaceId,
          summary: summary.summary,
          passages: passages.map((passage) => passage.text),
        },
        onUsage
      )
    : passages.map(() => "")
  const rows = [
    ...(summary
      ? [
          {
            kind: "summary" as const,
            startMs: 0,
            endMs: durationMs,
            context: `Summary of a call in #${channelName} on ${date}. Speakers: ${speakers.join(", ")}.`,
            text: summaryText(summary),
          },
        ]
      : []),
    ...passages.map((passage, index) => ({
      kind: "transcript" as const,
      startMs: passage.startMs,
      endMs: passage.endMs,
      context: [
        `Call in #${channelName} on ${date}, ${formatCallTime(passage.startMs)}–${formatCallTime(passage.endMs)} into the call. Speakers: ${passage.speakers.join(", ")}.`,
        situated[index],
      ]
        .filter(Boolean)
        .join(" "),
      text: passage.text,
    })),
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
  logger.info(
    { sessionId, passages: passages.length, summarized: summary !== null },
    "Call memory saved"
  )
}
