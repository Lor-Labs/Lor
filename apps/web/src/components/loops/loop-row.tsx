import { Infinity01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { cn } from "@repo/ui/lib/utils"
import type { ChannelLoop } from "@/hooks/use-channel-loops"

// Compact loop row shared by the overview panel's Loops section and the full
// loops list panel — same visual language as the chat chip: leading ∞ mark
// (purple while live), name + schedule, a quiet status word on the right when
// the loop isn't active. Sorting puts what needs attention first.

const STATUS_ORDER: Record<ChannelLoop["status"], number> = {
  active: 0,
  paused: 1,
  draft: 2,
  completed: 3,
}

export function sortLoops(loops: ChannelLoop[]): ChannelLoop[] {
  return [...loops].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.createdAt.localeCompare(a.createdAt)
  )
}

const STATUS_WORD: Partial<Record<ChannelLoop["status"], string>> = {
  paused: "Paused",
  draft: "Draft",
  completed: "Completed",
}

export function LoopRow({
  loop,
  onOpen,
}: {
  loop: ChannelLoop
  onOpen: () => void
}) {
  const statusWord = STATUS_WORD[loop.status]
  const isLive = loop.status === "active" || loop.status === "draft"
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.04]",
        loop.status === "completed" && "opacity-60"
      )}
    >
      <HugeiconsIcon
        icon={Infinity01Icon}
        size={15}
        className={cn(
          "shrink-0",
          isLive ? "text-primary" : "text-muted-foreground"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm leading-5">{loop.name}</p>
        <p className="truncate text-muted-foreground text-xs leading-4">
          {describeLoopSchedule(loop.schedule, null)}
        </p>
      </div>
      {statusWord && (
        <span className="shrink-0 text-muted-foreground text-xs">
          {statusWord}
        </span>
      )}
    </button>
  )
}
