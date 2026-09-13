export type LorReasoningSegment = {
  text: string
  at: number
  order: number
}

// Deprecated Merlin→Lor rename alias — removed in cleanup (LOR-87 C9).
export type MerlinReasoningSegment = LorReasoningSegment

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
