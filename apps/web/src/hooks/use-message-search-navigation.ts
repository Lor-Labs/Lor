import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"

export type MessageSearchTarget = {
  id: string
  channelId: string
  threadRootId: string | null
}

/** Navigate a workspace search result to its channel or containing thread. */
export function useMessageSearchNavigation() {
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const { view, setView, isCollapsed, toggleCollapsed } = useRightSidebar()

  return useCallback(
    (target: MessageSearchTarget) => {
      if (!workspaceSlug) return

      if (target.threadRootId) {
        setView({
          type: "thread",
          workspaceSlug,
          channelId: target.channelId,
          threadRootId: target.threadRootId,
          targetMessageId: target.id,
        })
        if (isCollapsed) toggleCollapsed()

        void navigate({
          to: "/$workspaceSlug/$channelId",
          params: { workspaceSlug, channelId: target.channelId },
          search: {
            msgId: target.threadRootId,
            threadId: target.threadRootId,
            threadMessageId: target.id,
          },
        })
        return
      }

      // A channel-level result should leave any currently open thread so the
      // main timeline owns the focused message again.
      if (view?.type === "thread") {
        setView({
          type: "workspace-members",
          workspaceSlug,
          channelId: target.channelId,
        })
      }
      void navigate({
        to: "/$workspaceSlug/$channelId",
        params: { workspaceSlug, channelId: target.channelId },
        search: { msgId: target.id },
      })
    },
    [workspaceSlug, view?.type, setView, isCollapsed, toggleCollapsed, navigate]
  )
}
