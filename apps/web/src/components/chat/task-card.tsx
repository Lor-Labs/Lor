import { CheckListIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@repo/ui/components/badge"
import {
  Frame,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@repo/ui/components/frame"
import { cn } from "@repo/ui/lib/utils"
import { ArtifactFileCard } from "@/components/chat/artifact-file-card"
import { TaskPlanList } from "@/components/chat/task-plan-list"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { useTaskForCard } from "@/hooks/use-channel-tasks"
import { useTaskArtifacts } from "@/hooks/use-task"
import type { Message } from "@/lib/api-types"
import { TASK_STATUS_META } from "@/lib/task-ui"

// The card a task_card message renders as: the stock coss Frame — title +
// status in the FrameHeader chrome, the live plan in the FramePanel,
// delivered files in the FrameFooter. Clicking opens the task's thread — a
// stretched overlay button carries the click so the file chips stay
// interactive.
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
      <Frame className="my-1 w-full">
        <FrameHeader className="flex-row items-center gap-2 px-4 py-2.5">
          <HugeiconsIcon
            icon={CheckListIcon}
            size={15}
            className="shrink-0 text-muted-foreground"
          />
          <FrameTitle>Task</FrameTitle>
        </FrameHeader>
        <FramePanel>
          <p className="line-clamp-2 text-muted-foreground text-sm leading-5">
            {message.content}
          </p>
        </FramePanel>
      </Frame>
    )
  }

  const meta = TASK_STATUS_META[task.status]

  return (
    <Frame
      className={cn(
        "group/task relative my-1 w-full transition-colors",
        isOpenThread ? "bg-muted ring-1 ring-primary/40" : "hover:bg-muted"
      )}
    >
      <button
        type="button"
        aria-label="Open task thread"
        onClick={() => onOpenThread?.(message.id)}
        className="absolute inset-0 z-10 cursor-pointer rounded-2xl"
      />
      <FrameHeader className="flex-row items-center gap-2 px-4 py-2.5">
        <HugeiconsIcon
          icon={CheckListIcon}
          size={15}
          className="shrink-0 text-muted-foreground"
        />
        <FrameTitle>Task</FrameTitle>
        <Badge
          variant={meta.badgeVariant}
          size="sm"
          className="ml-auto shrink-0"
        >
          <HugeiconsIcon
            icon={meta.icon}
            size={12}
            className={meta.spin ? "animate-spin" : undefined}
          />
          {meta.label}
        </Badge>
      </FrameHeader>
      <FramePanel>
        <p className="font-medium text-sm leading-5">{task.title}</p>
        {task.plan.length > 0 && (
          <TaskPlanList items={task.plan} className="mt-2.5" />
        )}
        {task.status === "running" && task.plan.length === 0 && (
          <p className="shimmer mt-2 text-muted-foreground text-sm">
            Merlin is working…
          </p>
        )}
        {task.status === "completed" && task.summary && (
          <p className="mt-3 border-t pt-3 text-muted-foreground text-sm leading-5">
            {task.summary}
          </p>
        )}
      </FramePanel>
      {artifacts && artifacts.length > 0 && (
        <FrameFooter className="relative z-20 flex flex-wrap gap-1.5 px-4 py-2.5">
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
        </FrameFooter>
      )}
    </Frame>
  )
}
