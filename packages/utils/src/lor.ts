export type LorReasoningSegment = {
  text: string
  at: number
  order: number
}

// Streamed reasoning arrives as order-keyed deltas: append to the segment
// with the same order, or start a new one.
export function appendReasoningSegment(
  segments: LorReasoningSegment[] | null | undefined,
  payload: { delta: string; at: number; order: number }
): LorReasoningSegment[] {
  const current = segments ?? []
  const existingIndex = current.findIndex(
    (segment) => segment.order === payload.order
  )
  if (existingIndex < 0) {
    return [
      ...current,
      { text: payload.delta, at: payload.at, order: payload.order },
    ]
  }
  return current.map((segment, index) =>
    index === existingIndex
      ? { ...segment, text: segment.text + payload.delta }
      : segment
  )
}

export function upsertToolCall<T extends { toolCallId: string }>(
  toolCalls: T[] | null | undefined,
  toolCall: T
): T[] {
  const current = toolCalls ?? []
  const existingIndex = current.findIndex(
    (item) => item.toolCallId === toolCall.toolCallId
  )
  return existingIndex < 0
    ? [...current, toolCall]
    : current.map((item, index) => (index === existingIndex ? toolCall : item))
}

// A failed reply's trailing text: output kept from before the failure, a
// blank line, then the failure message (lor-respond's persistFailure keeps
// blank lines out of the message itself).
export function splitFailedReply(text: string): {
  partial: string | null
  failure: string
} {
  const at = text.lastIndexOf("\n\n")
  const failure = (at < 0 ? text : text.slice(at + 2)).trim()
  return {
    partial: at < 0 ? null : text.slice(0, at).trim() || null,
    failure: failure || "Lor couldn't finish this response.",
  }
}
