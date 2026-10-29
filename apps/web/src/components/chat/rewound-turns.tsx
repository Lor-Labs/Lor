import { ArrowRight01Icon, Undo02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatDateTime } from "@repo/utils/date"
import type { Message } from "@/lib/api-types"

// A rewind's set-aside turns, folded right under the reply the session went
// back to (Jacob 2026-10-24: collapsed, not hidden, so a shared session shows
// who rewound and what). Expanded messages share a history surface; their
// Lor replies can still be forked.

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
  const { author } = group.event
  const hasHistory = group.count > 0
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!hasHistory}
      aria-expanded={hasHistory ? expanded : undefined}
      title={`Rewound ${formatDateTime(group.event.createdAt)}`}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset enabled:cursor-pointer enabled:hover:bg-muted/60",
        expanded ? "rounded-t-xl" : "rounded-xl"
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/70 text-muted-foreground">
        <HugeiconsIcon
          icon={Undo02Icon}
          className="size-3.5"
          strokeWidth={2}
          aria-hidden="true"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-foreground text-sm">
            Previous history
          </span>
          <span className="text-muted-foreground text-xs">
            {group.count} {group.count === 1 ? "message" : "messages"}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <Avatar className="size-3.5 shrink-0">
            {author.image && <AvatarImage src={author.image} alt="" />}
            <AvatarFallback
              avatarColor={author.avatarColor}
              fallbackSeed={author.name}
              className="font-semibold text-[7px]"
            >
              {getAvatarInitials(author.name)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{author.name} rewound to here</span>
        </span>
      </span>
      {hasHistory && (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
          {expanded ? "Hide" : "View"}
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className={cn(
              "size-3.5 transition-transform duration-200 ease-out",
              expanded && "rotate-90"
            )}
            strokeWidth={2}
            aria-hidden="true"
          />
        </span>
      )}
    </button>
  )
}
