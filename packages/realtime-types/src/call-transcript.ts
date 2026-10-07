import type { VoiceRequestState } from "./events"
import { hasVoiceResult } from "./voice-requests"

// How a call's transcript is laid out, shared by web and mobile: saved
// segments, capture gaps, and Lor's results in timeline order, grouped into
// one block per speaker turn.

// LiveKit's transcription text-stream protocol, which its client hooks read.
// Each caption update is a stream; updates to one segment share its id, which
// is also the saved segment's id.
export const CAPTION_TOPIC = "lk.transcription"
export const CAPTION_ATTRIBUTES = {
  trackId: "lk.transcribed_track_id",
  segmentId: "lk.segment_id",
  final: "lk.transcription_final",
} as const

// One speaker's phrases within this window share a block.
const BLOCK_WINDOW_MS = 2 * 60_000

export type TranscriptPageInput = {
  startedAt: string
  segments: {
    segmentId: string
    participantId: string
    startMs: number
    text: string
  }[]
  gaps: { participantId: string | null; startMs: number; endMs: number }[]
}

export type TranscriptLine = {
  id: string
  participantId: string
  at: number
  text: string
  // Live captions are shown dimmed until they're final.
  final: boolean
}
type TranscriptGap = {
  id: string
  participantId: string | null
  at: number
  durationMs: number
}
type LorEntry = { id: string; at: number; request: VoiceRequestState }

export type TranscriptBlock =
  | {
      kind: "speech"
      id: string
      participantId: string
      lines: TranscriptLine[]
    }
  | { kind: "gap"; id: string; gap: TranscriptGap }
  | { kind: "lor"; id: string; request: VoiceRequestState }

function toBlocks(entries: (TranscriptLine | TranscriptGap | LorEntry)[]) {
  const blocks: TranscriptBlock[] = []
  for (const entry of entries) {
    if ("durationMs" in entry) {
      blocks.push({ kind: "gap", id: entry.id, gap: entry })
      continue
    }
    if ("request" in entry) {
      blocks.push({ kind: "lor", id: entry.id, request: entry.request })
      continue
    }
    const last = blocks.at(-1)
    const previous = last?.kind === "speech" ? last.lines.at(-1) : undefined
    if (
      last?.kind === "speech" &&
      previous &&
      last.participantId === entry.participantId &&
      entry.at - previous.at <= BLOCK_WINDOW_MS
    ) {
      last.lines.push(entry)
    } else {
      blocks.push({
        kind: "speech",
        id: entry.id,
        participantId: entry.participantId,
        lines: [entry],
      })
    }
  }
  return blocks
}

// Saved segments, capture gaps, and Lor's results in timeline order, then live
// lines this device heard that aren't saved yet. Saved segments and captions
// share an id. A result sits where it was asked, just after the words that
// asked it.
export function buildTranscriptBlocks(
  pages: TranscriptPageInput[],
  liveLines: TranscriptLine[],
  requests: VoiceRequestState[]
) {
  const first = pages[0]
  if (!first) return []
  const startedAt = Date.parse(first.startedAt)
  const saved = pages.flatMap((page) => page.segments)
  const savedIds = new Set(saved.map((segment) => segment.segmentId))
  const entries: (TranscriptLine | TranscriptGap | LorEntry)[] = [
    ...requests
      .filter(
        (request) =>
          hasVoiceResult(request) ||
          request.status === "failed" ||
          request.status === "awaiting_approval"
      )
      .map((request) => ({
        id: request.id,
        at: Date.parse(request.createdAt),
        request,
      })),
    ...saved.map((segment) => ({
      id: segment.segmentId,
      participantId: segment.participantId,
      at: startedAt + segment.startMs,
      text: segment.text,
      final: true,
    })),
    ...first.gaps.map((gap, index) => ({
      id: `gap-${index}`,
      participantId: gap.participantId,
      at: startedAt + gap.startMs,
      durationMs: gap.endMs - gap.startMs,
    })),
  ].sort((a, b) => a.at - b.at)
  return toBlocks([
    ...entries,
    ...liveLines.filter((line) => !savedIds.has(line.id)),
  ])
}

// The spoken block at a moment of the call: the last one starting at or
// before it.
export function transcriptBlockAt(blocks: TranscriptBlock[], at: number) {
  let found: TranscriptBlock | undefined
  for (const block of blocks) {
    const start =
      block.kind === "speech"
        ? block.lines[0]?.at
        : block.kind === "gap"
          ? block.gap.at
          : undefined
    if (start === undefined) continue
    if (start > at) break
    found = block
  }
  return found ?? blocks.find((block) => block.kind !== "lor")
}
