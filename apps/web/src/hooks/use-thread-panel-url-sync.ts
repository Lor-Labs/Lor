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
  callAt,
  transientThreadRootId = null,
  panel,
}: {
  workspaceSlug: string
  channelId: string
  threadId: string | undefined
  threadMessageId: string | undefined
  // A call chat's transcript tab, at this moment of the call.
  callAt?: number
  transientThreadRootId?: string | null
  // ?panel=sessions: open the channel's Sessions list, then drop the param.
  panel?: "sessions"
}) {
  const { view, setView, clearView, isCollapsed, toggleCollapsed } =
    useRightSidebar()
  const isMobile = useIsMobile()
  const navigate = useNavigate({ from: "/$workspaceSlug/$channelId" })

  // Read the current threadId without re-running the mount effect on its
  // changes (runtime open/close is driven by the URL-sync effect below).
  const threadIdRef = useRef(threadId)
  threadIdRef.current = threadId
  const threadMessageIdRef = useRef(threadMessageId)
  threadMessageIdRef.current = threadMessageId
  const callAtRef = useRef(callAt)
  callAtRef.current = callAt

  // Set the initial right-panel view when entering a channel: reopen the
  // thread from the URL (refresh / deep link) or fall back to members.
  useEffect(() => {
    const initialThreadId = threadIdRef.current
    if (initialThreadId) {
      const initialCallAt = callAtRef.current
      setView({
        type: "thread",
        workspaceSlug,
        channelId,
        threadRootId: initialThreadId,
        targetMessageId: threadMessageIdRef.current,
        ...(initialCallAt === undefined
          ? {}
          : { callTab: "transcript", transcriptAtMs: initialCallAt }),
      })
    } else if (isMobile === false) {
      setView({ type: "workspace-members", workspaceSlug, channelId })
    }
    return () => {
      clearView()
    }
  }, [setView, clearView, workspaceSlug, channelId, isMobile])

  // After the mount effect above, so it wins on entry; also works when the
  // channel is already open.
  const isCollapsedRef = useRef(isCollapsed)
  isCollapsedRef.current = isCollapsed
  useEffect(() => {
    if (panel !== "sessions") return
    setView({ type: "sessions", workspaceSlug, channelId, filter: "active" })
    if (isCollapsedRef.current) toggleCollapsed()
    void navigate({
      search: (prev) => ({ ...prev, panel: undefined }),
      replace: true,
    })
  }, [panel, setView, toggleCollapsed, workspaceSlug, channelId, navigate])

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
      const mirroredCallAt =
        mirrored.callTab === "transcript" ? mirrored.transcriptAtMs : undefined
      if (
        mirrored.threadRootId !== threadId ||
        mirrored.targetMessageId !== threadMessageId ||
        mirroredCallAt !== callAt
      ) {
        void navigate({
          search: (prev) => ({
            ...prev,
            threadId: mirrored.threadRootId,
            threadMessageId: mirrored.targetMessageId,
            callAt: mirroredCallAt,
          }),
          replace: true,
        })
      }
    } else if (view && (threadId || threadMessageId || callAt !== undefined)) {
      // Only clear once a real view is set — `view === null` is the
      // pre-hydration state on refresh and must not wipe the URL's threadId.
      void navigate({
        search: (prev) => ({
          ...prev,
          threadId: undefined,
          threadMessageId: undefined,
          callAt: undefined,
        }),
        replace: true,
      })
    }
  }, [
    view,
    channelId,
    threadId,
    threadMessageId,
    callAt,
    transientThreadRootId,
    isMobile,
    navigate,
  ])
}
