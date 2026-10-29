import { memo, useMemo, useRef } from "react"
import { ArtifactFileCard } from "@/components/chat/artifact-file-card"
import { LorActivity, LorActivityGroup } from "@/components/chat/lor-activity"
import { LorCompactionDivider } from "@/components/chat/lor-compaction-divider"
import { LorFailureNotice } from "@/components/chat/lor-failure-notice"
import { LorReasoning } from "@/components/chat/lor-reasoning"
import { LorToolTrail } from "@/components/chat/lor-tool-trail"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import type {
  LorReasoningSegmentView,
  LorToolCallView,
  Message,
} from "@/lib/api-types"

type Segment =
  | { kind: "text"; key: string; text: string }
  | {
      kind: "reasoning"
      key: string
      reasoning: LorReasoningSegmentView
    }
  | { kind: "tools"; key: string; tools: LorToolCallView[] }
  // Context compaction marker (synthetic compact_context trail entry) —
  // rendered as a divider across the message, not a tool step.
  | { kind: "compaction"; key: string; tool: LorToolCallView }

const COMPACTION_TOOL_NAME = "compact_context"

type ActivityBlock =
  | Extract<Segment, { kind: "text" }>
  | {
      kind: "work"
      key: string
      segments: Exclude<Segment, { kind: "text" }>[]
    }

function groupActivity(segments: Segment[]): ActivityBlock[] {
  const blocks: ActivityBlock[] = []
  for (const segment of segments) {
    if (segment.kind === "text") {
      if (segment.text.trim()) blocks.push(segment)
      continue
    }
    const previous = blocks.at(-1)
    if (previous?.kind === "work") {
      previous.segments.push(segment)
    } else {
      blocks.push({ kind: "work", key: segment.key, segments: [segment] })
    }
  }
  return blocks
}

type TimelineEvent =
  | {
      kind: "reasoning"
      at: number
      order: number
      sequence: number
      reasoning: LorReasoningSegmentView
    }
  | {
      kind: "tool"
      at: number
      order: number
      sequence: number
      tool: LorToolCallView
    }

function buildSegments(
  content: string,
  toolCalls: LorToolCallView[],
  reasoningSegments: LorReasoningSegmentView[]
): Segment[] {
  const clamp = (n: number) => Math.min(Math.max(n, 0), content.length)
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
  ].sort((a, b) => a.at - b.at || a.order - b.order || a.sequence - b.sequence)

  const segments: Segment[] = []
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

    if (event.tool.toolName === COMPACTION_TOOL_NAME) {
      segments.push({
        kind: "compaction",
        key: `compaction:${event.tool.toolCallId}`,
        tool: event.tool,
      })
      index += 1
      continue
    }

    const tools: LorToolCallView[] = [event.tool]
    index += 1
    let next = events[index]
    while (
      next?.kind === "tool" &&
      next.at === event.at &&
      next.tool.toolName !== COMPACTION_TOOL_NAME
    ) {
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

export const LorMessageBody = memo(function LorMessageBody({
  content,
  toolCalls,
  reasoningSegments,
  streaming,
  failed = false,
  legacyReasoning,
  mentions,
  onCitationJump,
}: {
  content: string | null
  toolCalls: LorToolCallView[]
  reasoningSegments: LorReasoningSegmentView[]
  streaming?: boolean
  failed?: boolean
  legacyReasoning?: string | null
  mentions: Message["mentions"]
  onCitationJump?: (messageId: string) => void
}) {
  const wasStreaming = useRef(false)
  if (streaming) wasStreaming.current = true
  const { segments, deliverables } = useMemo(() => {
    // Files this answer produced, presented as cards at the end of the
    // message — deduped by artifact so a re-run keeps the latest version.
    const files = new Map<
      string,
      NonNullable<LorToolCallView["files"]>[number]
    >()
    for (const toolCall of toolCalls) {
      for (const file of toolCall.files ?? []) {
        files.set(file.artifactId, file)
      }
    }
    return {
      segments: buildSegments(content ?? "", toolCalls, reasoningSegments),
      deliverables: [...files.values()],
    }
  }, [content, toolCalls, reasoningSegments])

  // The trailing text is the answer. Earlier text belongs to the work log.
  // Settled legacy replies may have tool entries after their answer text.
  // A failed run ending in tool activity has no answer — don't promote
  // pre-tool narration to one.
  let answerIndex = -1
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]
    if (segment?.kind === "text" && segment.text.trim()) {
      answerIndex = index
      break
    }
    if (streaming || failed) break
  }
  const answer = segments[answerIndex]
  const activitySegments = segments.filter((_, index) => index !== answerIndex)
  if (legacyReasoning) {
    activitySegments.unshift({
      kind: "reasoning",
      key: "reasoning:legacy",
      reasoning: { text: legacyReasoning, at: 0, order: -1 },
    })
  }
  const activityBlocks = groupActivity(activitySegments)
  const visibleTools = toolCalls.filter(
    (tool) => tool.toolName !== COMPACTION_TOOL_NAME
  )

  return (
    <>
      {activityBlocks.length > 0 && (
        <LorActivity
          active={Boolean(streaming)}
          failed={failed}
          toolCount={visibleTools.length}
          errorCount={
            visibleTools.filter((tool) => tool.status === "error").length
          }
        >
          {activityBlocks.map((block) => {
            if (block.kind === "text") {
              return (
                <MessageMarkdown
                  key={block.key}
                  content={block.text}
                  mentions={mentions}
                  onCitationJump={onCitationJump}
                  className="text-foreground leading-relaxed"
                />
              )
            }
            const groupTools = block.segments.flatMap((segment) =>
              segment.kind === "tools" ? segment.tools : []
            )
            return (
              <LorActivityGroup
                key={block.key}
                active={
                  Boolean(streaming) &&
                  block.segments.at(-1) === segments.at(-1)
                }
                runActive={Boolean(streaming)}
                bare={activityBlocks.length === 1}
                toolCount={groupTools.length}
                errorCount={
                  groupTools.filter((tool) => tool.status === "error").length
                }
              >
                {block.segments.map((segment) => {
                  if (segment.kind === "reasoning") {
                    return (
                      <LorReasoning
                        key={segment.key}
                        text={segment.reasoning.text}
                        active={
                          Boolean(streaming) && segment === segments.at(-1)
                        }
                      />
                    )
                  }
                  if (segment.kind === "compaction") {
                    return (
                      <LorCompactionDivider
                        key={segment.key}
                        active={!!streaming && !segment.tool.status}
                      />
                    )
                  }
                  return (
                    <LorToolTrail
                      key={segment.key}
                      toolCalls={segment.tools}
                      streaming={streaming}
                      embedded
                    />
                  )
                })}
              </LorActivityGroup>
            )
          })}
        </LorActivity>
      )}
      {answer?.kind === "text" && !failed && (
        <MessageMarkdown
          content={answer.text}
          mentions={mentions}
          onCitationJump={onCitationJump}
        />
      )}
      {/* A failed run's text is the worker's failure message, not an answer. */}
      {failed && (
        <LorFailureNotice
          arrived={wasStreaming.current}
          text={
            answer?.kind === "text"
              ? answer.text
              : "Lor couldn't finish this response."
          }
        />
      )}
      {deliverables.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {deliverables.map((file) => (
            <ArtifactFileCard
              key={file.artifactId}
              artifactId={file.artifactId}
              name={file.path}
              size={file.size}
            />
          ))}
        </div>
      )}
    </>
  )
})
