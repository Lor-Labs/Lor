import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"

// Keeps the right panel's thread in step with ?threadId: a refresh or deep
// link reopens it, and closing the thread drops it. Shared by the text and
// voice channel pages. `transientThreadRootId` (a live call's chat) opens
// from the URL but is never written back, so a refresh can't reopen a chat
// the person may no longer be allowed to read.
export function useThreadPanelUrlSync({
  workspaceSlug,
  channelId,
  threadId,
  threadMessageId,
  transientThreadRootId = null,
}: {
  workspaceSlug: string
  channelId: string
  threadId: string | undefined
  threadMessageId: string | undefined
  transientThreadRootId?: string | null
}) {
  const { view, setView, clearView } = useRightSidebar()
  const isMobile = useIsMobile()
  const navigate = useNavigate({ from: "/$workspaceSlug/$channelId" })

  // Read the current threadId without re-running the mount effect on its
  // changes (runtime open/close is driven by the URL-sync effect below).
  const threadIdRef = useRef(threadId)
  threadIdRef.current = threadId
  const threadMessageIdRef = useRef(threadMessageId)
  threadMessageIdRef.current = threadMessageId

  // Set the initial right-panel view when entering a channel: reopen the
  // thread from the URL (refresh / deep link) or fall back to members.
  useEffect(() => {
    const initialThreadId = threadIdRef.current
    if (initialThreadId) {
      setView({
        type: "thread",
        workspaceSlug,
        channelId,
        threadRootId: initialThreadId,
        targetMessageId: threadMessageIdRef.current,
      })
    } else if (isMobile === false) {
      setView({ type: "workspace-members", workspaceSlug, channelId })
    }
    return () => {
      clearView()
    }
  }, [setView, clearView, workspaceSlug, channelId, isMobile])

  // Mirror view → URL (the mount effect does URL → view). Skip views for
  // another channel: a cross-channel jump (search result, Lor citation) sets
  // the target's view before navigation lands, and mirroring it here would
  // pull the URL back to this channel.
  useEffect(() => {
    if (isMobile !== false) return
    if (view && view.channelId !== channelId) return
    const mirrored =
      view?.type === "thread" && view.threadRootId !== transientThreadRootId
        ? view
        : null
    if (mirrored) {
      if (
        mirrored.threadRootId !== threadId ||
        mirrored.targetMessageId !== threadMessageId
      ) {
        void navigate({
          search: (prev) => ({
            ...prev,
            threadId: mirrored.threadRootId,
            threadMessageId: mirrored.targetMessageId,
          }),
          replace: true,
        })
      }
    } else if (view && (threadId || threadMessageId)) {
      // Only clear once a real view is set — `view === null` is the
      // pre-hydration state on refresh and must not wipe the URL's threadId.
      void navigate({
        search: (prev) => ({
          ...prev,
          threadId: undefined,
          threadMessageId: undefined,
        }),
        replace: true,
      })
    }
  }, [
    view,
    channelId,
    threadId,
    threadMessageId,
    transientThreadRootId,
    isMobile,
    navigate,
  ])
}
