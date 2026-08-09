import {
  CheckmarkCircle02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import type { ChannelTask } from "@/hooks/use-channel-tasks"

type PlanItem = ChannelTask["plan"][number]

function Marker({ status }: { status: PlanItem["status"] }) {
  if (status === "done") {
    return (
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        size={15}
        className="text-success"
      />
    )
  }
  if (status === "active") {
    return (
      <HugeiconsIcon
        icon={Loading03Icon}
        size={15}
        className="animate-spin text-primary"
      />
    )
  }
  return (
    <span className="size-[9px] rounded-full border-[1.5px] border-muted-foreground/40" />
  )
}

export function TaskPlanList({
  items,
  className,
}: {
  items: PlanItem[]
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <ul className={cn("space-y-1.5", className)}>
      {items.map((item) => (
        <li key={item.text} className="flex gap-2 text-sm leading-5">
          <span className="flex h-5 w-4 shrink-0 items-center justify-center">
            <Marker status={item.status} />
          </span>
          <span
            className={
              item.status === "active"
                ? "text-foreground"
                : "text-muted-foreground"
            }
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  )
}
