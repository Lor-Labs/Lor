import { Image01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AnimatePresence, motion } from "motion/react"
import type { ReactNode } from "react"
import { PinnedMessagesPanel } from "@/components/sidebar/right-panel/pinned-messages-panel"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import type { RightSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { ThreadPanel } from "@/components/sidebar/right-panel/thread-panel"
import { WorkspaceMembersPanel } from "@/components/sidebar/right-panel/workspace-members-panel"

function PlaceholderSidebar({
  title,
  description,
  icon,
  workspaceSlug,
  channelId,
}: {
  title: string
  description: string
  icon: ReactNode
  workspaceSlug: string
  channelId: string
}) {
  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title={title}
        workspaceSlug={workspaceSlug}
        channelId={channelId}
      />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 rounded-full bg-foreground/5 p-3 text-muted-foreground">
          {icon}
        </div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

const viewTransition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1] as const,
}

const threadExitTransition = {
  duration: 0.06,
  ease: "linear" as const,
}

export function RightSidebarPanel({ view }: { view: RightSidebarView }) {
  // Use view.type as the key for AnimatePresence — switching between views
  // unmounts the old and mounts the new with the slide/fade transition.
  // For thread we also key on threadRootId so jumping between threads
  // re-runs the entry animation.
  const key = view.type === "thread" ? `thread:${view.threadRootId}` : view.type

  return (
    <div className="relative h-full w-full overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          initial={{ x: 18, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{
            x: -4,
            opacity: 0,
            transition:
              view.type === "thread" ? threadExitTransition : viewTransition,
          }}
          transition={viewTransition}
          className="flex h-full w-full flex-col"
        >
          {view.type === "workspace-members" && (
            <WorkspaceMembersPanel view={view} />
          )}
          {view.type === "pinned-messages" && (
            <PinnedMessagesPanel view={view} />
          )}
          {view.type === "thread" && <ThreadPanel view={view} />}
          {view.type === "attachments" && (
            <PlaceholderSidebar
              title="Attachments"
              description="This mode can show channel attachments and media history."
              icon={
                <HugeiconsIcon
                  icon={Image01Icon}
                  className="size-5"
                  strokeWidth={2}
                />
              }
              workspaceSlug={view.workspaceSlug}
              channelId={view.channelId}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
