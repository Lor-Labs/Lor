import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

// A code session's pull request review, read live from GitHub. The review
// card in the thread and the Details panel's Review list share it; GitHub's
// webhooks say when to refetch (reference/planned/pr-reviews.md).

const REVIEW_STALE_MS = 60_000

export const sessionReviewKey = (sessionId: string) =>
  ["session-review", sessionId] as const

export function sessionReviewQueryOptions(sessionId: string) {
  return {
    queryKey: sessionReviewKey(sessionId),
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].review.$get({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Couldn't load the review")
      const { review } = await res.json()
      return review
    },
    staleTime: REVIEW_STALE_MS,
  }
}

export function useSessionReview(
  sessionId: string,
  threadRootId: string,
  enabled = true
) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket || !enabled) return
    const onUpdated = (payload: { threadRootId: string }) => {
      if (payload.threadRootId !== threadRootId) return
      void queryClient.invalidateQueries({
        queryKey: sessionReviewKey(sessionId),
      })
    }
    socket.on("session:review:updated", onUpdated)
    return () => {
      socket.off("session:review:updated", onUpdated)
    }
  }, [socket, queryClient, sessionId, threadRootId, enabled])
  return useQuery({ ...sessionReviewQueryOptions(sessionId), enabled })
}

export type SessionReview = NonNullable<
  ReturnType<typeof useSessionReview>["data"]
>
export type ReviewThread = SessionReview["threads"][number]
