import { Infinity01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { Badge } from "@repo/ui/components/badge"
import type { ChannelLoop } from "@/hooks/use-channel-loops"
import { LOOP_STATUS_META } from "@/lib/loop-ui"

// Compact loop row shared by the overview panel's Loops section and the full
// loops list panel. Sorting puts what needs attention first.

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

function formatRunTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function loopSubtitle(loop: ChannelLoop): string {
  const schedule = describeLoopSchedule(loop.schedule, null)
  if (loop.status === "active" && loop.nextRunAt) {
    return `${schedule} · Next run ${formatRunTime(loop.nextRunAt)}`
  }
  if (loop.lastRunAt) {
    return `${schedule} · Last run ${formatRunTime(loop.lastRunAt)}`
  }
  return schedule
}

export function LoopRow({
  loop,
  onOpen,
}: {
  loop: ChannelLoop
  onOpen: () => void
}) {
  const meta = LOOP_STATUS_META[loop.status]
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/[0.04]"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground ring-1 ring-border/40 ring-inset">
        <HugeiconsIcon icon={Infinity01Icon} size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm leading-5">{loop.name}</p>
        <p className="truncate text-muted-foreground text-xs leading-4">
          {loopSubtitle(loop)}
        </p>
      </div>
      <Badge variant={meta.badgeVariant} size="sm" className="shrink-0">
        <HugeiconsIcon icon={meta.icon} size={12} />
        {meta.label}
      </Badge>
    </button>
  )
}
