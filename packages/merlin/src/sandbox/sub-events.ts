import type { MerlinToolCallUpdate } from "@repo/db/schema"
import { logger } from "../logger"
import type { PiCodeHandlers } from "./pi-events"

// Emit at most every this many new characters — the live summary is a
// preview, not a token stream.
const TEXT_FLUSH_CHARS = 256
const MAX_SUMMARY_CHARS = 16_000

// Adapts a Pi run's live events into merlin:tool frames: sub-steps upsert
// under the parent by Pi's stable toolCallId, and the agent's streaming
// answer text lands on the parent's detail.summary — the same field its
// final findings fill on completion, so live and settled renders converge.
export function subagentToolEvents(opts: {
  parentToolCallId: string
  onToolEvent?: (e: MerlinToolCallUpdate) => void
}): PiCodeHandlers {
  const emit = (e: MerlinToolCallUpdate) => {
    // A failing listener must not abort or fail the sandbox session.
    try {
      opts.onToolEvent?.(e)
    } catch (err) {
      logger.error({ err }, "Merlin onToolEvent listener failed")
    }
  }
  let sentLength = 0
  return {
    onStep: (step) => {
      emit({
        toolCallId: `${opts.parentToolCallId}:sub:${step.toolCallId}`,
        parentToolCallId: opts.parentToolCallId,
        toolName: step.toolName,
        label: step.label,
        ...(step.status ? { status: step.status } : {}),
        ...(step.diff ? { diff: step.diff } : {}),
      })
    },
    onAssistantText: (text) => {
      // Snapshot semantics: a shorter text means a new assistant message
      // started and the summary resets.
      const grew = text.length - sentLength
      if (grew >= 0 && grew < TEXT_FLUSH_CHARS) return
      if (sentLength >= MAX_SUMMARY_CHARS && grew >= 0) return
      sentLength = text.length
      emit({
        toolCallId: opts.parentToolCallId,
        detail: { summary: text.slice(0, MAX_SUMMARY_CHARS) },
      })
    },
  }
}
