import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { apiClient } from "@/lib/api-client"

type CallLocation = { channelId: string; threadRootId: string }

// A call never moves, so its location caches for the session. Null = not
// found; the API answers 404 for calls the viewer can't access too.
function callLocationQuery(sessionId: string) {
  return {
    queryKey: ["voice-call-location", sessionId],
    queryFn: async (): Promise<CallLocation | null> => {
      const res = await apiClient.v1.voice.sessions[":sessionId"].$get({
        param: { sessionId },
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`call lookup failed: ${res.status}`)
      const { channelId, session } = await res.json()
      return session.threadRootId
        ? { channelId, threadRootId: session.threadRootId }
        : null
    },
    staleTime: Number.POSITIVE_INFINITY,
  }
}

/** Open a call's transcript at a moment, from a Lor [[call:…]] citation.
 * Resolves false when the call isn't found. Citations prefetch on hover. */
export function useCallCitation() {
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setView, isCollapsed, toggleCollapsed } = useRightSidebar()

  const open = useCallback(
    async (sessionId: string, atMs: number) => {
      if (!workspaceSlug) return false
      const location = await queryClient.fetchQuery(
        callLocationQuery(sessionId)
      )
      if (!location) return false
      setView({
        type: "thread",
        workspaceSlug,
        channelId: location.channelId,
        threadRootId: location.threadRootId,
        callTab: "transcript",
        transcriptAtMs: atMs,
      })
      if (isCollapsed) toggleCollapsed()
      void navigate({
        to: "/$workspaceSlug/$channelId",
        params: { workspaceSlug, channelId: location.channelId },
        search: { threadId: location.threadRootId, callAt: atMs },
      })
      return true
    },
    [
      workspaceSlug,
      queryClient,
      setView,
      isCollapsed,
      toggleCollapsed,
      navigate,
    ]
  )
  const prefetch = useCallback(
    (sessionId: string) => {
      void queryClient.prefetchQuery(callLocationQuery(sessionId))
    },
    [queryClient]
  )
  return { open, prefetch }
}
