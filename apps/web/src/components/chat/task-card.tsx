import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@repo/ui/components/badge"
import { cn } from "@repo/ui/lib/utils"
import { ArtifactFileCard } from "@/components/chat/artifact-file-card"
import {
  TaskPlanList,
  TaskPlanProgress,
} from "@/components/chat/task-plan-list"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { useTaskForCard } from "@/hooks/use-channel-tasks"
import { useTaskArtifacts } from "@/hooks/use-task"
import type { Message } from "@/lib/api-types"
import { TASK_STATUS_META } from "@/lib/task-ui"

// The card a task_card message renders as: title and outcome in the header, the
// live plan in a recessed well, delivered files underneath. Clicking opens the
// task's thread — a stretched overlay button carries the click, so the step rows
// and file chips (both z-20) stay interactive.
const SURFACE_CLASS =
  "relative mt-1.5 w-full max-w-xl overflow-hidden rounded-xl border bg-card transition-colors"

export function TaskCard({
  message,
  onOpenThread,
}: {
  message: Message
  onOpenThread?: (rootMessageId: string) => void
}) {
  const task = useTaskForCard(message.channelId, message.id)
  const { data: artifacts } = useTaskArtifacts(task?.id ?? null)
  const { view, isCollapsed } = useRightSidebar()
  const isOpenThread =
    !isCollapsed && view?.type === "thread" && view.threadRootId === message.id

  if (!task) {
    return (
      <div className={SURFACE_CLASS}>
        <p className="line-clamp-2 px-4 py-3.5 text-muted-foreground text-sm leading-5">
          {message.content}
        </p>
      </div>
    )
  }

  const meta = TASK_STATUS_META[task.status]
  const isComplete = task.status === "completed"
  // One description slot, showing whatever matters most right now: the outcome
  // once delivered, otherwise the ask that started the task.
  const description = (isComplete ? task.summary : null) ?? task.goal

  return (
    <div
      className={cn(
        "group/task",
        SURFACE_CLASS,
        isOpenThread
          ? "border-foreground/25 bg-foreground/[0.03]"
          : "hover:bg-muted/30"
      )}
    >
      {onOpenThread && (
        <button
          type="button"
          aria-label="Open task thread"
          onClick={() => onOpenThread(message.id)}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl"
        />
      )}

      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div className="min-w-0 space-y-1">
          <p className="text-pretty font-medium text-sm leading-5">
            {task.title}
          </p>
          {description && (
            <p className="line-clamp-2 text-pretty text-muted-foreground text-sm leading-5">
              {description}
            </p>
          )}
        </div>
        {isComplete ? (
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={18}
            className="mt-0.5 shrink-0 text-foreground"
          />
        ) : (
          <Badge variant={meta.badgeVariant} size="sm" className="shrink-0">
            <HugeiconsIcon
              icon={meta.icon}
              size={12}
              className={meta.spin ? "animate-spin" : undefined}
            />
            {meta.label}
          </Badge>
        )}
      </div>

      <div className="px-4 py-4">
        <div className="min-w-0 rounded-lg bg-muted/70 px-4 py-3.5">
          {task.plan.length > 1 && <TaskPlanProgress items={task.plan} />}
          {task.plan.length > 0 && (
            <TaskPlanList
              items={task.plan}
              className={task.plan.length > 1 ? "mt-4" : undefined}
            />
          )}
          {task.status === "running" && task.plan.length === 0 && (
            <p className="shimmer text-muted-foreground text-sm">
              Merlin is working…
            </p>
          )}
        </div>

        {artifacts && artifacts.length > 0 && (
          <div className="relative z-20 mt-3 flex flex-wrap gap-1.5">
            {artifacts.map((artifact) => (
              <ArtifactFileCard
                key={artifact.id}
                artifactId={artifact.id}
                name={artifact.path}
                contentType={artifact.mime}
                size={artifact.size}
                variant="chip"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
