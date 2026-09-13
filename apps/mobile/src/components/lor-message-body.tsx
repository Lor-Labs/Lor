import { useMemo } from "react"
import { Text, View } from "react-native"
import { LorActivity } from "@/components/lor-activity"
import { LorReasoning } from "@/components/lor-reasoning"
import { LorToolTrail } from "@/components/lor-tool-trail"
import { MessageContent } from "@/components/message-content"
import { PlanFileRow } from "@/components/plan-ui"
import type { Message } from "@/lib/api-types"
import { buildLorSegments, type LorToolCall } from "@/lib/lor"

export function LorMessageBody({
  message,
  streaming,
  onCitationJump,
}: {
  message: Message
  streaming: boolean
  onCitationJump?: (messageId: string) => void
}) {
  const { segments, childrenByParent, deliverables } = useMemo(() => {
    const toolCalls = message.lorToolCalls ?? []
    const children = new Map<string, LorToolCall[]>()
    // Deliverables from any top-level tool call (mirrors web) — presented at
    // the end of the message, deduped by artifact (the latest version wins).
    const files = new Map<string, NonNullable<LorToolCall["files"]>[number]>()
    for (const toolCall of toolCalls) {
      if (toolCall.parentToolCallId) {
        const existing = children.get(toolCall.parentToolCallId) ?? []
        existing.push(toolCall)
        children.set(toolCall.parentToolCallId, existing)
        continue
      }
      for (const file of toolCall.files ?? []) {
        files.set(file.artifactId, file)
      }
    }
    return {
      segments: buildLorSegments(
        message.content ?? "",
        toolCalls.filter((toolCall) => !toolCall.parentToolCallId),
        message.lorReasoningSegments ?? []
      ),
      childrenByParent: children,
      deliverables: [...files.values()],
    }
  }, [message])

  // Work/answer split (mirrors web lor-message-body): the trailing text is
  // the answer; everything before it is the work log, collapsed behind the
  // activity disclosure. While streaming (or after a failure) nothing is
  // promoted to an answer yet.
  const failed = message.status === "failed"
  let answerIndex = -1
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]
    if (segment?.kind === "text" && segment.text.trim()) {
      answerIndex = index
      break
    }
    if (streaming || failed) break
  }
  const answer = answerIndex >= 0 ? segments[answerIndex] : undefined
  const activitySegments = segments
    .map((segment, index) => ({ segment, index }))
    .filter(
      ({ segment, index }) =>
        index !== answerIndex &&
        (segment.kind !== "text" || segment.text.trim())
    )
  const topLevelTools = (message.lorToolCalls ?? []).filter(
    (toolCall) => !toolCall.parentToolCallId
  )

  const renderSegment = ({
    segment,
    index,
  }: (typeof activitySegments)[number]) => {
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
        <LorReasoning
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
      <LorToolTrail
        childrenByParent={childrenByParent}
        key={segment.key}
        streaming={streaming && isLast}
        toolCalls={segment.tools}
      />
    )
  }

  return (
    <>
      {activitySegments.length > 0 ? (
        <LorActivity
          active={streaming}
          errorCount={
            topLevelTools.filter((toolCall) => toolCall.status === "error")
              .length
          }
          failed={failed}
          toolCount={topLevelTools.length}
        >
          {activitySegments.map(renderSegment)}
        </LorActivity>
      ) : null}
      {answer?.kind === "text" ? (
        <MessageContent
          content={answer.text}
          mentions={message.mentions}
          onCitationJump={onCitationJump}
          streaming={streaming && answerIndex === segments.length - 1}
        />
      ) : null}
      {failed && !answer ? (
        <Text className="text-sm italic text-muted">
          Lor couldn't finish this response.
        </Text>
      ) : null}
      {deliverables.length > 0 ? (
        <View className="mt-one max-w-[420px] gap-one">
          {deliverables.map((file) => (
            <PlanFileRow
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
