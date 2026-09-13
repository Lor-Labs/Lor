import { appendReasoningSegment, upsertToolCall } from "@repo/utils/merlin"
import type { Message } from "@/lib/api-types"

export type MerlinToolCall = NonNullable<Message["lorToolCalls"]>[number]
export type MerlinReasoningSegment = NonNullable<
  Message["lorReasoningSegments"]
>[number]

export type MerlinBodySegment =
  | { kind: "text"; key: string; text: string }
  | { kind: "reasoning"; key: string; reasoning: MerlinReasoningSegment }
  | { kind: "tools"; key: string; tools: MerlinToolCall[] }

type TimelineEvent =
  | {
      kind: "reasoning"
      at: number
      order: number
      sequence: number
      reasoning: MerlinReasoningSegment
    }
  | {
      kind: "tool"
      at: number
      order: number
      sequence: number
      tool: MerlinToolCall
    }

export function buildMerlinSegments(
  content: string,
  toolCalls: MerlinToolCall[],
  reasoningSegments: MerlinReasoningSegment[]
): MerlinBodySegment[] {
  const clamp = (value: number) => Math.min(Math.max(value, 0), content.length)
  const events: TimelineEvent[] = [
    ...reasoningSegments.map((reasoning, sequence) => ({
      kind: "reasoning" as const,
      at: clamp(reasoning.at),
      order: reasoning.order,
      sequence,
      reasoning,
    })),
    ...toolCalls.map((tool, sequence) => ({
      kind: "tool" as const,
      at: clamp(tool.at ?? content.length),
      order: tool.order ?? Number.MAX_SAFE_INTEGER,
      sequence: reasoningSegments.length + sequence,
      tool,
    })),
  ].sort((left, right) =>
    left.at === right.at
      ? left.order === right.order
        ? left.sequence - right.sequence
        : left.order - right.order
      : left.at - right.at
  )

  const segments: MerlinBodySegment[] = []
  let cursor = 0
  let index = 0
  while (index < events.length) {
    const event = events[index]
    if (!event) break
    if (event.at > cursor) {
      segments.push({
        kind: "text",
        key: `text:${cursor}`,
        text: content.slice(cursor, event.at),
      })
      cursor = event.at
    }
    if (event.kind === "reasoning") {
      segments.push({
        kind: "reasoning",
        key: `reasoning:${event.reasoning.order}`,
        reasoning: event.reasoning,
      })
      index += 1
      continue
    }

    const tools = [event.tool]
    index += 1
    let next = events[index]
    while (next?.kind === "tool" && next.at === event.at) {
      tools.push(next.tool)
      index += 1
      next = events[index]
    }
    segments.push({
      kind: "tools",
      key: `tools:${tools[0]?.toolCallId ?? cursor}`,
      tools,
    })
  }

  if (cursor < content.length) {
    segments.push({
      kind: "text",
      key: `text:${cursor}`,
      text: content.slice(cursor),
    })
  }
  return segments
}

export function appendMerlinReasoning(
  message: Message,
  payload: { delta: string; at: number; order: number }
) {
  return {
    ...message,
    lorReasoning: (message.lorReasoning ?? "") + payload.delta,
    lorReasoningSegments: appendReasoningSegment(
      message.lorReasoningSegments,
      payload
    ),
    status: "pending" as const,
  }
}

export function upsertMerlinToolCall(
  message: Message,
  toolCall: MerlinToolCall
) {
  return {
    ...message,
    lorToolCalls: upsertToolCall(message.lorToolCalls, toolCall),
  }
}
