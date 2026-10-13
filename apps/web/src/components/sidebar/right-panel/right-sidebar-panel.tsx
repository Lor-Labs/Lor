import { EASE_OUT } from "@repo/ui/lib/motion"
import { AnimatePresence, motion } from "motion/react"
import { FilePanel } from "@/components/artifacts/file-panel"
import { ChannelFilesPanel } from "@/components/sidebar/right-panel/channel-files-panel"
import { LoopPanel } from "@/components/sidebar/right-panel/loop-panel"
import { LoopsListPanel } from "@/components/sidebar/right-panel/loops-list-panel"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { RightSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { SessionWorkPanel } from "@/components/sidebar/right-panel/session-work-panel"
import { SessionsListPanel } from "@/components/sidebar/right-panel/sessions-list-panel"
import { ThreadPanel } from "@/components/sidebar/right-panel/thread-panel"
import { WorkspaceMembersPanel } from "@/components/sidebar/right-panel/workspace-members-panel"

const enterTransition = { duration: 0.22, ease: EASE_OUT }
const exitTransition = { duration: 0.12, ease: EASE_OUT }

export function RightSidebarPanel({ view }: { view: RightSidebarView | null }) {
  const { fileId } = useRightSidebar()
  // Use view.type as the key for AnimatePresence — switching between views
  // unmounts the old and mounts the new with the slide/fade transition.
  // For thread we also key on threadRootId so jumping between threads
  // re-runs the entry animation (same for loops and files).
  const key = fileId
    ? `file:${fileId}`
    : !view
      ? "empty"
      : view.type === "thread" || view.type === "session-work"
        ? `${view.type}:${view.threadRootId}`
        : view.type === "loop"
          ? `loop:${view.loopId}`
          : `${view.type}:${view.channelId}`

  // popLayout: the next view enters while the old one fades out, so a view
  // switch never waits for the exit to finish.
  return (
    <div className="relative h-full w-full overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={key}
          initial={{ x: 12, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ opacity: 0, transition: exitTransition }}
          transition={enterTransition}
          className="flex h-full w-full flex-col"
        >
          {fileId ? (
            <FilePanel artifactId={fileId} />
          ) : (
            <>
              {view?.type === "workspace-members" && (
                <WorkspaceMembersPanel view={view} />
              )}
              {view?.type === "thread" && <ThreadPanel view={view} />}
              {view?.type === "loop" && <LoopPanel view={view} />}
              {view?.type === "loops" && <LoopsListPanel view={view} />}
              {view?.type === "attachments" && (
                <ChannelFilesPanel view={view} />
              )}
              {view?.type === "session-work" && (
                <SessionWorkPanel view={view} />
              )}
              {view?.type === "sessions" && <SessionsListPanel view={view} />}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
