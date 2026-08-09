import { MagicWand01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import {
  ACTIVE_TASK_STATUSES,
  useChannelTasks,
} from "@/hooks/use-channel-tasks"

// Persistent "quests in flight" affordance — the anti-lost-in-scroll anchor.
// Clicking opens the most recent active quest's thread.
export function ActiveQuestsChip({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const { data: tasks } = useChannelTasks(channelId)
  const { setView, isCollapsed, toggleCollapsed } = useRightSidebar()

  const active =
    tasks?.filter((t) => ACTIVE_TASK_STATUSES.includes(t.status)) ?? []
  const latest = active[0]
  if (!latest) return null

  const openQuest = () => {
    setView({
      type: "thread",
      workspaceSlug,
      channelId,
      threadRootId: latest.cardMessageId,
    })
    if (isCollapsed) toggleCollapsed()
  }

  return (
    <button
      type="button"
      onClick={openQuest}
      className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground"
    >
      <HugeiconsIcon
        icon={MagicWand01Icon}
        size={15}
        className="text-primary"
      />
      <span>{active.length === 1 ? "1 quest" : `${active.length} quests`}</span>
    </button>
  )
}
