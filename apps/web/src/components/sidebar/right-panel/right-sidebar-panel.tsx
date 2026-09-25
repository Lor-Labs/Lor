import { AnimatePresence, motion } from "motion/react"
import { ChannelFilesPanel } from "@/components/sidebar/right-panel/channel-files-panel"
import { LoopPanel } from "@/components/sidebar/right-panel/loop-panel"
import { LoopsListPanel } from "@/components/sidebar/right-panel/loops-list-panel"
import type { RightSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { ThreadPanel } from "@/components/sidebar/right-panel/thread-panel"
import { WorkspaceMembersPanel } from "@/components/sidebar/right-panel/workspace-members-panel"

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
  // re-runs the entry animation (same for loops).
  const key =
    view.type === "thread"
      ? `thread:${view.threadRootId}`
      : view.type === "loop"
        ? `loop:${view.loopId}`
        : `${view.type}:${view.channelId}`

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
          {view.type === "thread" && <ThreadPanel view={view} />}
          {view.type === "loop" && <LoopPanel view={view} />}
          {view.type === "loops" && <LoopsListPanel view={view} />}
          {view.type === "attachments" && <ChannelFilesPanel view={view} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
