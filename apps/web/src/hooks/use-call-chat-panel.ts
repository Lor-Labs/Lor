import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { useVoiceCall } from "@/context/voice-call-context"

// The live call's chat in the right panel, from the call controls and the
// sidebar call bar. Closed by default; unread counts while it's closed.
export function useCallChatPanel() {
  const { call, chatUnread, clearChatUnread } = useVoiceCall()
  const { view, setView, isCollapsed, toggleCollapsed } = useRightSidebar()
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const threadRootId = call?.threadRootId ?? null
  // The right panel only renders inside a workspace.
  const open =
    Boolean(threadRootId && workspaceSlug) &&
    view?.type === "thread" &&
    view.threadRootId === threadRootId &&
    !isCollapsed

  useEffect(() => {
    if (open && chatUnread > 0) clearChatUnread()
  }, [open, chatUnread, clearChatUnread])

  const toggle = useCallback(() => {
    if (!call || !threadRootId) return
    if (open) {
      toggleCollapsed()
      return
    }
    if (isCollapsed) toggleCollapsed()
    if (workspaceSlug) {
      setView({
        type: "thread",
        workspaceSlug: call.workspaceSlug,
        channelId: call.channelId,
        threadRootId,
      })
      return
    }
    // From DMs: the voice channel page opens the chat from ?threadId.
    void navigate({
      to: "/$workspaceSlug/$channelId",
      params: { workspaceSlug: call.workspaceSlug, channelId: call.channelId },
      search: { threadId: threadRootId },
    })
  }, [
    call,
    threadRootId,
    open,
    isCollapsed,
    toggleCollapsed,
    workspaceSlug,
    setView,
    navigate,
  ])

  return {
    available: Boolean(call && threadRootId),
    open,
    unread: chatUnread,
    toggle,
  }
}
