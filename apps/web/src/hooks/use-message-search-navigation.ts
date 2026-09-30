import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { apiClient } from "@/lib/api-client"

export type MessageSearchTarget = {
  id: string
  channelId: string
  threadRootId: string | null
  // Defaults to the current route's workspace; notifications set it.
  workspaceSlug?: string
}

/** Navigate a workspace search result to its channel or containing thread. */
export function useMessageSearchNavigation() {
  const { workspaceSlug: routeWorkspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const { view, setView, clearView, isCollapsed, toggleCollapsed } =
    useRightSidebar()
  const isMobile = useIsMobile()

  return useCallback(
    (target: MessageSearchTarget) => {
      const workspaceSlug = target.workspaceSlug ?? routeWorkspaceSlug
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
      routeWorkspaceSlug,
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

export type MessageLocation = {
  messageId: string
  channelId: string
  threadRootId: string | null
}

// A message never moves, so its location caches for the session. null = not
// found. Other failures throw so they are not cached, including 403: access
// can be granted later in the session.
function locationQuery(workspaceSlug: string, messageId: string) {
  return {
    queryKey: ["message-location", workspaceSlug, messageId],
    queryFn: async (): Promise<MessageLocation | null> => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].messages[
        ":messageId"
      ].$get({ param: { workspaceSlug, messageId } })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`message lookup failed: ${res.status}`)
      return await res.json()
    },
    staleTime: Number.POSITIVE_INFINITY,
  }
}

/** Resolve a message id to its channel and thread. Citations prefetch on hover
 * so the click navigates without waiting on the lookup. */
export function useMessageLocation() {
  const { workspaceSlug } = useParams({ strict: false })
  const queryClient = useQueryClient()

  const resolve = useCallback(
    (messageId: string): Promise<MessageLocation | null> =>
      workspaceSlug
        ? queryClient.fetchQuery(locationQuery(workspaceSlug, messageId))
        : Promise.resolve(null),
    [workspaceSlug, queryClient]
  )
  const prefetch = useCallback(
    (messageId: string) => {
      if (workspaceSlug) {
        void queryClient.prefetchQuery(locationQuery(workspaceSlug, messageId))
      }
    },
    [workspaceSlug, queryClient]
  )
  return { resolve, prefetch }
}

/** Jump to a message known only by id (a Lor [[msg:]] citation) like a search
 * result. False = not found. */
export function useMessageIdNavigation() {
  const { resolve } = useMessageLocation()
  const navigateToMessage = useMessageSearchNavigation()

  return useCallback(
    async (messageId: string): Promise<boolean> => {
      const loc = await resolve(messageId)
      if (!loc) return false
      navigateToMessage({
        id: loc.messageId,
        channelId: loc.channelId,
        threadRootId: loc.threadRootId,
      })
      return true
    },
    [resolve, navigateToMessage]
  )
}
