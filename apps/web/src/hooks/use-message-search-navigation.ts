import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { apiClient } from "@/lib/api-client"

export type MessageSearchTarget = {
  id: string
  channelId: string
  threadRootId: string | null
}

/** Navigate a workspace search result to its channel or containing thread. */
export function useMessageSearchNavigation() {
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const { view, setView, clearView, isCollapsed, toggleCollapsed } =
    useRightSidebar()
  const isMobile = useIsMobile()

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
      if (isMobile) {
        clearView()
      } else if (view?.type === "thread") {
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
    [
      workspaceSlug,
      view?.type,
      setView,
      clearView,
      isMobile,
      isCollapsed,
      toggleCollapsed,
      navigate,
    ]
  )
}

/** Jump to a message known only by id (a Lor [[msg:]] citation): resolve its
 * channel and thread, then navigate like a search result. False = not found. */
export function useMessageIdNavigation() {
  const { workspaceSlug } = useParams({ strict: false })
  const navigateToMessage = useMessageSearchNavigation()

  return useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!workspaceSlug) return false
      const res = await apiClient.v1.workspaces[":workspaceSlug"].messages[
        ":messageId"
      ].$get({ param: { workspaceSlug, messageId } })
      if (!res.ok) return false
      const loc = await res.json()
      navigateToMessage({
        id: loc.messageId,
        channelId: loc.channelId,
        threadRootId: loc.threadRootId,
      })
      return true
    },
    [workspaceSlug, navigateToMessage]
  )
}
