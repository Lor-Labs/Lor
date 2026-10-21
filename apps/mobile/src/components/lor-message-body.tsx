import { useMemo } from "react"
import { View } from "react-native"
import { FileChip } from "@/components/file-chip"
import { LorActivity } from "@/components/lor-activity"
import { LorFailureNotice } from "@/components/lor-failure-notice"
import { LorReasoning } from "@/components/lor-reasoning"
import { LorToolTrail } from "@/components/lor-tool-trail"
import { MessageContent } from "@/components/message-content"
import type { Message } from "@/lib/api-types"
import { buildLorSegments, type LorToolCall } from "@/lib/lor"
import { openFile } from "@/lib/open-file"

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
      {answer?.kind === "text" && !failed ? (
        <MessageContent
          content={answer.text}
          mentions={message.mentions}
          onCitationJump={onCitationJump}
          streaming={streaming && answerIndex === segments.length - 1}
        />
      ) : null}
      {/* A failed run's text is the worker's failure message, not an answer. */}
      {failed ? (
        <LorFailureNotice
          text={
            answer?.kind === "text"
              ? answer.text
              : "Lor couldn't finish this response."
          }
        />
      ) : null}
      {deliverables.length > 0 ? (
        <View className="mt-one max-w-[420px] gap-one">
          {deliverables.map((file) => (
            <FileChip
              key={file.artifactId}
              name={file.path}
              onPress={() => openFile({ artifactId: file.artifactId })}
              size={file.size}
            />
          ))}
        </View>
      ) : null}
    </>
  )
}
