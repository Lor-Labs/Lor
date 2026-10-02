import type { VoiceRequestState } from "@repo/realtime-types/events"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export function voiceRequestsQueryKey(sessionId: string) {
  return ["voice-requests", sessionId] as const
}

const ACTIVE_STATUSES: ReadonlySet<VoiceRequestState["status"]> = new Set([
  "listening",
  "queued",
  "working",
])

export function isActiveVoiceRequest(request: VoiceRequestState) {
  return ACTIVE_STATUSES.has(request.status)
}

// Requests to Lor in the live call this device is in. Events reach only the
// call; the fetch covers joining late and socket reconnects.
export function useVoiceRequests(sessionId: string | null) {
  const socket = useSocket()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: voiceRequestsQueryKey(sessionId ?? ""),
    enabled: sessionId !== null,
    queryFn: async (): Promise<VoiceRequestState[]> => {
      if (!sessionId) return []
      const res = await apiClient.v1.voice.sessions[":sessionId"].requests.$get(
        { param: { sessionId } }
      )
      if (!res.ok) throw new Error("Failed to load requests to Lor")
      return (await res.json()).requests
    },
  })

  useEffect(() => {
    if (!socket || !sessionId) return
    const queryKey = voiceRequestsQueryKey(sessionId)
    const onUpdated = ({ request }: { request: VoiceRequestState }) => {
      if (request.sessionId !== sessionId) return
      queryClient.setQueryData<VoiceRequestState[]>(queryKey, (current) => {
        const list = current ?? []
        const existing = list.find((entry) => entry.id === request.id)
        // Events from the transcriber and the API can arrive out of order.
        if (existing && existing.updatedAt > request.updatedAt) return list
        const rest = list.filter((entry) => entry.id !== request.id)
        if (request.status === "rejected") return rest
        return [...rest, request].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt)
        )
      })
    }
    const onReconnect = () => {
      void queryClient.invalidateQueries({ queryKey })
    }
    socket.on("voice:request:updated", onUpdated)
    socket.on("connect", onReconnect)
    return () => {
      socket.off("voice:request:updated", onUpdated)
      socket.off("connect", onReconnect)
    }
  }, [socket, sessionId, queryClient])

  const requests = query.data ?? []
  return {
    requests,
    active: requests.filter(isActiveVoiceRequest).at(-1) ?? null,
  }
}
