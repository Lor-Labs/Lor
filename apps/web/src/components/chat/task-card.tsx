import {
  CheckmarkCircle02Icon,
  Loading03Icon,
  MagicWand01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@repo/ui/components/badge"
import { useTaskForCard } from "@/hooks/use-channel-tasks"
import type { Message } from "@/lib/api-types"
import { TASK_STATUS_META } from "@/lib/task-ui"

function PlanItemMarker({ status }: { status: "pending" | "active" | "done" }) {
  if (status === "done") {
    return (
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        size={14}
        className="shrink-0 text-success"
      />
    )
  }
  if (status === "active") {
    return (
      <HugeiconsIcon
        icon={Loading03Icon}
        size={14}
        className="shrink-0 animate-spin text-muted-foreground"
      />
    )
  }
  return (
    <span className="mx-[3px] size-2 shrink-0 rounded-full border border-muted-foreground/50" />
  )
}

// The card a task_card message renders as: live status, plan checklist,
// summary. Clicking opens the task's thread — the full workspace (steering,
// approvals, artifacts) lives there.
export function TaskCard({
  message,
  onOpenThread,
}: {
  message: Message
  onOpenThread?: (rootMessageId: string) => void
}) {
  const task = useTaskForCard(message.channelId, message.id)

  if (!task) {
    return (
      <div className="my-1 w-full max-w-xl rounded-lg border bg-card p-3 text-muted-foreground text-sm">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={MagicWand01Icon} size={16} />
          <span>Task</span>
        </div>
        <p className="mt-1 line-clamp-2">{message.content}</p>
      </div>
    )
  }

  const meta = TASK_STATUS_META[task.status]

  return (
    <button
      type="button"
      onClick={() => onOpenThread?.(message.id)}
      className="my-1 block w-full max-w-xl cursor-pointer rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/40"
    >
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={MagicWand01Icon}
          size={16}
          className="shrink-0 text-primary"
        />
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Task
        </span>
        <Badge variant={meta.badgeVariant} size="sm" className="ml-auto">
          <HugeiconsIcon
            icon={meta.icon}
            size={12}
            className={meta.spin ? "animate-spin" : undefined}
          />
          {meta.label}
        </Badge>
      </div>
      <p className="mt-1.5 font-medium text-sm">{task.title}</p>
      {task.plan.length > 0 && (
        <ul className="mt-2 space-y-1">
          {task.plan.map((item) => (
            <li key={item.text} className="flex items-center gap-2 text-sm">
              <PlanItemMarker status={item.status} />
              <span
                className={
                  item.status === "done"
                    ? "text-muted-foreground line-through"
                    : item.status === "pending"
                      ? "text-muted-foreground"
                      : undefined
                }
              >
                {item.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {task.status === "completed" && task.summary && (
        <p className="mt-2 border-t pt-2 text-muted-foreground text-sm">
          {task.summary}
        </p>
      )}
    </button>
  )
}
