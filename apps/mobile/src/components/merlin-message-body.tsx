import { useMemo } from "react"
import { View } from "react-native"
import { MerlinReasoning } from "@/components/merlin-reasoning"
import { MerlinToolTrail } from "@/components/merlin-tool-trail"
import { MessageContent } from "@/components/message-content"
import { TaskFileRow } from "@/components/task-ui"
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
  const { segments, childrenByParent, deliverables } = useMemo(() => {
    const toolCalls = message.merlinToolCalls ?? []
    const children = new Map<string, MerlinToolCall[]>()
    // Files produced by create_artifacts — presented at the end of the
    // message, deduped by artifact (the latest version wins).
    const files = new Map<
      string,
      NonNullable<MerlinToolCall["files"]>[number]
    >()
    for (const toolCall of toolCalls) {
      if (toolCall.parentToolCallId) {
        const existing = children.get(toolCall.parentToolCallId) ?? []
        existing.push(toolCall)
        children.set(toolCall.parentToolCallId, existing)
        continue
      }
      if (toolCall.toolName === "create_artifacts") {
        for (const file of toolCall.files ?? []) {
          files.set(file.artifactId, file)
        }
      }
    }
    return {
      segments: buildMerlinSegments(
        message.content ?? "",
        toolCalls.filter((toolCall) => !toolCall.parentToolCallId),
        message.merlinReasoningSegments ?? []
      ),
      childrenByParent: children,
      deliverables: [...files.values()],
    }
  }, [message])

  const rendered = segments.map((segment, index) => {
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

  return (
    <>
      {rendered}
      {deliverables.length > 0 ? (
        <View className="mt-one max-w-[420px] gap-one">
          {deliverables.map((file) => (
            <TaskFileRow
              key={file.artifactId}
              name={file.path}
              size={file.size}
              url={file.url}
            />
          ))}
        </View>
      ) : null}
    </>
  )
}
