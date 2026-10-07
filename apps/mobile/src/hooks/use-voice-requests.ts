import type {
  VoiceRequestActivity,
  VoiceRequestReaction,
  VoiceRequestState,
} from "@repo/realtime-types/events"
import {
  hasVoiceResult,
  mergeVoiceRequest,
  pickVoiceRequestOnStage,
} from "@repo/realtime-types/voice-requests"
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { Alert } from "react-native"
import { addLorReaction, addLorTool } from "@/components/voice/lor-stage-store"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"

const NO_REQUESTS: VoiceRequestState[] = []

export function voiceRequestsQueryKey(sessionId: string) {
  return ["voice-requests", sessionId] as const
}

// Requests the dev simulator fakes on this phone; the server never saw them.
const SIMULATED_ID_PREFIX = "dev-sim-"
export const simulatedRequestId = () =>
  `${SIMULATED_ID_PREFIX}${Math.random().toString(36).slice(2)}`
export const isSimulatedRequest = (request: Pick<VoiceRequestState, "id">) =>
  request.id.startsWith(SIMULATED_ID_PREFIX)

// The Linear and GitHub references a result names; its cards query is keyed
// by them.
export function entityRefs(request: Pick<VoiceRequestState, "result">) {
  return (request.result?.blocks ?? [])
    .flatMap((block) =>
      block.type === "linear_issues"
        ? block.issues
        : block.type === "github_pull_requests"
          ? block.pullRequests
          : []
    )
    .join(",")
}

export function entityCardsQueryKey(requestId: string, refs: string) {
  return ["voice-entity-cards", requestId, refs] as const
}

function voiceRequestsQuery(sessionId: string | null) {
  return {
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
  }
}

// Every request to Lor in a call, for its transcript. During the call, the
// call screen's useVoiceRequests keeps the same cache live.
export function useVoiceRequestList(sessionId: string) {
  return useQuery(voiceRequestsQuery(sessionId)).data ?? NO_REQUESTS
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

// Requests to Lor in the call this phone is in: the one Lor's window shows,
// and the results it can step back through. Same rules as web; events arrive
// through the call chat's room, which the call provider holds for the whole
// call.
export function useVoiceRequests(sessionId: string | null) {
  const socket = useSocket()
  const queryClient = useQueryClient()

  const query = useQuery(voiceRequestsQuery(sessionId))

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
  return {
    onStage: pickVoiceRequestOnStage(requests),
    results: requests.filter(hasVoiceResult),
  }
}

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
  const res = await api.v1.voice.requests[":requestId"].stage
    .$post({ param: { requestId: request.id } })
    .catch(() => null)
  if (!res?.ok) {
    Alert.alert("Couldn't show that in Lor's window")
    void queryClient.invalidateQueries({ queryKey })
  }
}
