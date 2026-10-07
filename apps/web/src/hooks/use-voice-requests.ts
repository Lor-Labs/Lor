import type {
  VoiceRequestActivity,
  VoiceRequestReaction,
  VoiceRequestState,
} from "@repo/realtime-types/events"
import {
  hasVoiceResult,
  isActiveVoiceRequest,
  mergeVoiceRequest,
  pickVoiceRequestOnStage,
} from "@repo/realtime-types/voice-requests"
import { toast } from "@repo/ui/components/toast"
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { addLorReaction, addLorTool } from "@/components/voice/lor-stage-store"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"
import { isSimulatedRequest } from "@/lib/lor-simulation"

export { isActiveVoiceRequest, hasVoiceResult as hasResult }

export function voiceRequestsQueryKey(sessionId: string) {
  return ["voice-requests", sessionId] as const
}

export function applyVoiceRequestUpdate(
  queryClient: QueryClient,
  request: VoiceRequestState
) {
  queryClient.setQueryData<VoiceRequestState[]>(
    voiceRequestsQueryKey(request.sessionId),
    (current) => mergeVoiceRequest(current ?? [], request)
  )
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
      applyVoiceRequestUpdate(queryClient, request)
    }
    const onActivity = (activity: VoiceRequestActivity) => {
      if (activity.sessionId === sessionId) {
        addLorTool(activity.requestId, activity.toolName)
      }
    }
    const onReaction = (reaction: VoiceRequestReaction) => {
      if (reaction.sessionId === sessionId) {
        addLorReaction(reaction.requestId, reaction.emoji)
      }
    }
    const onReconnect = () => {
      void queryClient.invalidateQueries({ queryKey })
    }
    socket.on("voice:request:updated", onUpdated)
    socket.on("voice:request:activity", onActivity)
    socket.on("voice:request:reaction", onReaction)
    socket.on("connect", onReconnect)
    return () => {
      socket.off("voice:request:updated", onUpdated)
      socket.off("voice:request:activity", onActivity)
      socket.off("voice:request:reaction", onReaction)
      socket.off("connect", onReconnect)
    }
  }, [socket, sessionId, queryClient])

  const requests = query.data ?? NO_REQUESTS
  const results = requests.filter(hasVoiceResult)
  return { requests, results, onStage: pickVoiceRequestOnStage(requests) }
}

const NO_REQUESTS: VoiceRequestState[] = []

// Brings a result back into Lor's window for everyone in the call.
export async function stageVoiceRequest(
  queryClient: QueryClient,
  request: VoiceRequestState
) {
  const queryKey = voiceRequestsQueryKey(request.sessionId)
  const stagedAt = new Date().toISOString()
  queryClient.setQueryData<VoiceRequestState[]>(queryKey, (list) =>
    list?.map((entry) =>
      entry.id === request.id
        ? { ...entry, stagedAt, dismissedAt: null }
        : entry
    )
  )
  if (isSimulatedRequest(request)) return
  const res = await apiClient.v1.voice.requests[":requestId"].stage
    .$post({ param: { requestId: request.id } })
    .catch(() => null)
  if (!res?.ok) {
    toast.error("Couldn't show that in Lor's window")
    void queryClient.invalidateQueries({ queryKey })
  }
}
