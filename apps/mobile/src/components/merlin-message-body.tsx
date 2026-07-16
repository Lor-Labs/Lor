import { useMemo } from "react"
import { MerlinReasoning } from "@/components/merlin-reasoning"
import { MerlinToolTrail } from "@/components/merlin-tool-trail"
import { MessageContent } from "@/components/message-content"
import type { Message } from "@/lib/api-types"
import { buildMerlinSegments, type MerlinToolCall } from "@/lib/merlin"

export function MerlinMessageBody({
  message,
  streaming,
  onCitationJump,
}: {
  message: Message
  streaming: boolean
  onCitationJump?: (messageId: string) => void
}) {
  const { segments, childrenByParent } = useMemo(() => {
    const toolCalls = message.merlinToolCalls ?? []
    const children = new Map<string, MerlinToolCall[]>()
    for (const toolCall of toolCalls) {
      if (!toolCall.parentToolCallId) continue
      const existing = children.get(toolCall.parentToolCallId) ?? []
      existing.push(toolCall)
      children.set(toolCall.parentToolCallId, existing)
    }
    return {
      segments: buildMerlinSegments(
        message.content ?? "",
        toolCalls.filter((toolCall) => !toolCall.parentToolCallId),
        message.merlinReasoningSegments ?? []
      ),
      childrenByParent: children,
    }
  }, [message])

  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1
    if (segment.kind === "text") {
      return (
        <MessageContent
          content={segment.text}
          key={segment.key}
          mentions={message.mentions}
          onCitationJump={onCitationJump}
          streaming={streaming && isLast}
        />
      )
    }
    if (segment.kind === "reasoning") {
      return (
        <MerlinReasoning
          active={
            streaming &&
            isLast &&
            segment.reasoning.at >= (message.content?.length ?? 0)
          }
          key={segment.key}
          text={segment.reasoning.text}
        />
      )
    }
    return (
      <MerlinToolTrail
        childrenByParent={childrenByParent}
        key={segment.key}
        streaming={streaming && isLast}
        toolCalls={segment.tools}
      />
    )
  })
}
