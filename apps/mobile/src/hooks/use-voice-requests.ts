import type { VoiceRequestState } from "@repo/realtime-types/events"
import {
  mergeVoiceRequest,
  pickVoiceRequestOnStage,
} from "@repo/realtime-types/voice-requests"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"

const NO_REQUESTS: VoiceRequestState[] = []

export function voiceRequestsQueryKey(sessionId: string) {
  return ["voice-requests", sessionId] as const
}

// Requests to Lor in the call this phone is in, and the one Lor's window
// shows. Same rules as web; events arrive through the call chat's room, which
// the call screen holds for the whole call.
export function useVoiceRequests(sessionId: string | null) {
  const socket = useSocket()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: voiceRequestsQueryKey(sessionId ?? ""),
    enabled: sessionId !== null,
    queryFn: async (): Promise<VoiceRequestState[]> => {
      if (!sessionId) return []
      const res = await api.v1.voice.sessions[":sessionId"].requests.$get({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Failed to load requests to Lor")
      return (await res.json()).requests
    },
  })

  useEffect(() => {
    if (!socket || !sessionId) return
    const queryKey = voiceRequestsQueryKey(sessionId)
    const onUpdated = ({ request }: { request: VoiceRequestState }) => {
      if (request.sessionId !== sessionId) return
      queryClient.setQueryData<VoiceRequestState[]>(queryKey, (current) =>
        mergeVoiceRequest(current ?? [], request)
      )
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

  return pickVoiceRequestOnStage(query.data ?? NO_REQUESTS)
}
