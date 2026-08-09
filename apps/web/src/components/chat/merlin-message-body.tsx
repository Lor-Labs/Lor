import { useMemo } from "react"
import { ArtifactFileCard } from "@/components/chat/artifact-file-card"
import { MerlinReasoning } from "@/components/chat/merlin-reasoning"
import { MerlinToolTrail } from "@/components/chat/merlin-tool-trail"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import type {
  MerlinReasoningSegmentView,
  MerlinToolCallView,
  Message,
} from "@/lib/api-types"

type Segment =
  | { kind: "text"; key: string; text: string }
  | {
      kind: "reasoning"
      key: string
      reasoning: MerlinReasoningSegmentView
    }
  | { kind: "tools"; key: string; tools: MerlinToolCallView[] }

type TimelineEvent =
  | {
      kind: "reasoning"
      at: number
      order: number
      sequence: number
      reasoning: MerlinReasoningSegmentView
    }
  | {
      kind: "tool"
      at: number
      order: number
      sequence: number
      tool: MerlinToolCallView
    }

function buildSegments(
  content: string,
  toolCalls: MerlinToolCallView[],
  reasoningSegments: MerlinReasoningSegmentView[]
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

    const tools: MerlinToolCallView[] = [event.tool]
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

export function MerlinMessageBody({
  content,
  toolCalls,
  reasoningSegments,
  streaming,
  mentions,
  onCitationJump,
}: {
  content: string | null
  toolCalls: MerlinToolCallView[]
  reasoningSegments: MerlinReasoningSegmentView[]
  streaming?: boolean
  mentions: Message["mentions"]
  onCitationJump?: (messageId: string) => void
}) {
  // Only top-level calls drive timeline segmentation; nested sub-steps render
  // inside their parent tool's trail.
  const { segments, childrenByParent, deliverables } = useMemo(() => {
    const children = new Map<string, MerlinToolCallView[]>()
    for (const toolCall of toolCalls) {
      if (!toolCall.parentToolCallId) continue
      const childCalls = children.get(toolCall.parentToolCallId) ?? []
      childCalls.push(toolCall)
      children.set(toolCall.parentToolCallId, childCalls)
    }
    const topLevel = toolCalls.filter((toolCall) => !toolCall.parentToolCallId)
    // Files this answer produced, presented as cards at the end of the
    // message — deduped by artifact so a re-run keeps the latest version.
    const files = new Map<
      string,
      NonNullable<MerlinToolCallView["files"]>[number]
    >()
    for (const toolCall of topLevel) {
      for (const file of toolCall.files ?? []) {
        files.set(file.artifactId, file)
      }
    }
    return {
      segments: buildSegments(content ?? "", topLevel, reasoningSegments),
      childrenByParent: children,
      deliverables: [...files.values()],
    }
  }, [content, toolCalls, reasoningSegments])

  return (
    <>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1
        if (segment.kind === "text") {
          return (
            <MessageMarkdown
              key={segment.key}
              content={segment.text}
              mentions={mentions}
              onCitationJump={onCitationJump}
            />
          )
        }
        if (segment.kind === "reasoning") {
          return (
            <MerlinReasoning
              key={segment.key}
              text={segment.reasoning.text}
              active={
                !!streaming &&
                isLast &&
                segment.reasoning.at >= (content?.length ?? 0)
              }
            />
          )
        }
        return (
          <MerlinToolTrail
            key={segment.key}
            toolCalls={segment.tools}
            childrenByParent={childrenByParent}
            streaming={streaming && isLast}
          />
        )
      })}
      {deliverables.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {deliverables.map((file) => (
            <ArtifactFileCard
              key={file.artifactId}
              artifactId={file.artifactId}
              name={file.path}
              contentType={file.contentType}
              size={file.size}
            />
          ))}
        </div>
      )}
    </>
  )
}
