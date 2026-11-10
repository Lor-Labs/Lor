import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"

// A code session's pull request review, read live from GitHub; GitHub's
// webhooks say when to refetch. Mirrors web's use-session-review.ts; same
// query key (reference/planned/pr-reviews.md).

const REVIEW_STALE_MS = 60_000

export const sessionReviewKey = (sessionId: string) =>
  ["session-review", sessionId] as const

export function useSessionReview(sessionId: string, threadRootId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
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
  }, [socket, queryClient, sessionId, threadRootId])
  return useQuery({
    queryKey: sessionReviewKey(sessionId),
    queryFn: async () => {
      const res = await api.v1.sessions[":sessionId"].review.$get({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Couldn't load the review")
      const { review } = await res.json()
      return review
    },
    staleTime: REVIEW_STALE_MS,
  })
}

export type SessionReview = NonNullable<
  ReturnType<typeof useSessionReview>["data"]
>
export type ReviewThread = SessionReview["threads"][number]
