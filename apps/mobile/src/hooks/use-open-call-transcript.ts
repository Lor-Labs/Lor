import { useQueryClient } from "@tanstack/react-query"
import { router, usePathname } from "expo-router"
import { useCallback } from "react"
import { Alert } from "react-native"
import { api } from "@/lib/api"

type CallLocation = { channelId: string; threadRootId: string }

// A call never moves, so its location caches for the session. Same key as
// web. Null: missing, deleted, or not visible to this person (the API answers
// 404 for all three).
function callLocationQuery(sessionId: string) {
  return {
    queryKey: ["voice-call-location", sessionId],
    queryFn: async (): Promise<CallLocation | null> => {
      const res = await api.v1.voice.sessions[":sessionId"].$get({
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

// Opens a call's transcript, at a moment when given: a Lor [[call:…]]
// citation, or a time on Lor's summary card. Inside that call's chat it
// switches tabs in place.
export function useOpenCallTranscript() {
  const queryClient = useQueryClient()
  const pathname = usePathname()

  return useCallback(
    async (sessionId: string, atMs?: number) => {
      const location = await queryClient
        .fetchQuery(callLocationQuery(sessionId))
        .catch(() => null)
      if (!location) {
        Alert.alert(
          "Call unavailable",
          "This call may have been deleted, or you may not have access to its channel."
        )
        return
      }
      const params = {
        tab: "transcript",
        at: atMs === undefined ? undefined : String(atMs),
      }
      if (
        pathname ===
        `/channel/${location.channelId}/thread/${location.threadRootId}`
      ) {
        router.setParams(params)
        return
      }
      router.push({
        pathname: "/channel/[channelId]/thread/[threadRootId]",
        params: { ...location, ...params },
      } as never)
    },
    [queryClient, pathname]
  )
}
