import { SessionEventRow } from "@/components/chat/channel-event-row"
import type { Message } from "@/lib/api-types"

// A rewind's set-aside turns, folded right under the reply the session went
// back to (Jacob 2026-10-24: collapsed, not hidden, so a shared session shows
// who rewound and what). Show unfolds them dimmed; their Lor replies can
// still be forked.

// replies[start..end): the set-aside messages; replies[end]: the newest
// rewind event of the group. Overlapping rewinds (a second one to an earlier
// reply) fold together.
export type RewoundGroup = {
  start: number
  end: number
  event: Message
  count: number
}

export function rewoundGroups(replies: Message[]): RewoundGroup[] {
  const ranges = replies
    .flatMap((message, end) => {
      if (message.type !== "event" || message.eventType !== "session_rewound") {
        return []
      }
      const to = (message.eventPayload as { toMessageId?: string } | null)
        ?.toMessageId
      // The reply may be on an older page: the fold starts at the top.
      const start = replies.findIndex((candidate) => candidate.id === to) + 1
      return [{ start, end }]
    })
    .sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged.flatMap(({ start, end }) => {
    const event = replies[end]
    if (!event) return []
    const count = replies
      .slice(start, end)
      .filter((message) => message.type !== "event").length
    return [{ start, end, event, count }]
  })
}

export function RewoundTurnsRow({
  group,
  expanded,
  onToggle,
}: {
  group: RewoundGroup
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <SessionEventRow
      message={group.event}
      trailing={
        group.count > 0 ? (
          <>
            {" · "}
            {group.count} {group.count === 1 ? "message" : "messages"}
            {" · "}
            <button
              type="button"
              onClick={onToggle}
              className="cursor-pointer font-medium text-foreground/80 underline-offset-2 hover:underline"
            >
              {expanded ? "Hide" : "Show"}
            </button>
          </>
        ) : null
      }
    />
  )
}
