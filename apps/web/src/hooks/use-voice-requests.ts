import type {
  VoiceRequestActivity,
  VoiceRequestReaction,
  VoiceRequestState,
} from "@repo/realtime-types/events"
import { toast } from "@repo/ui/components/toast"
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { isSimulatedRequest } from "@/components/voice/lor-simulator"
import { addLorReaction, addLorTool } from "@/components/voice/lor-stage-store"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export function voiceRequestsQueryKey(sessionId: string) {
  return ["voice-requests", sessionId] as const
}

const ACTIVE_STATUSES: ReadonlySet<VoiceRequestState["status"]> = new Set([
  "listening",
  "queued",
  "working",
  "awaiting_approval",
])

export function isActiveVoiceRequest(
  request: Pick<VoiceRequestState, "status">
) {
  return ACTIVE_STATUSES.has(request.status)
}

export function applyVoiceRequestUpdate(
  queryClient: QueryClient,
  request: VoiceRequestState
) {
  queryClient.setQueryData<VoiceRequestState[]>(
    voiceRequestsQueryKey(request.sessionId),
    (current) => {
      const list = current ?? []
      const existing = list.find((entry) => entry.id === request.id)
      // Events from the transcriber and the API can arrive out of order.
      if (existing && existing.updatedAt > request.updatedAt) return list
      const rest = list.filter((entry) => entry.id !== request.id)
      if (request.status === "rejected") return rest
      return [...rest, request].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      )
    }
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
  const results = requests.filter(hasResult)
  return { requests, results, onStage: pickOnStage(requests) }
}

const NO_REQUESTS: VoiceRequestState[] = []

export function hasResult(request: VoiceRequestState) {
  return request.status === "done" && request.result !== null
}

const time = (value: string | null) => (value ? Date.parse(value) : 0)

// When a request last took Lor's window: it was made, it finished, or
// someone staged it again.
const stageTime = (request: VoiceRequestState) =>
  Math.max(
    time(request.createdAt),
    time(request.finishedAt),
    time(request.stagedAt)
  )

// What Lor's window shows. A request in flight always does. Otherwise the
// request that most recently took the window, until it's cleared; a cancel
// takes the window and closes it, so it never brings back an earlier one.
// Requests that a later one replaced mid-run (done, no result) never show.
function pickOnStage(requests: VoiceRequestState[]) {
  const latest = requests.at(-1)
  if (latest && isActiveVoiceRequest(latest)) return latest
  let top: VoiceRequestState | null = null
  for (const request of requests) {
    if (request.status === "done" && !request.result) continue
    if (!top || stageTime(request) >= stageTime(top)) top = request
  }
  return top && top.status !== "cancelled" && !top.dismissedAt ? top : null
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
  const res = await apiClient.v1.voice.requests[":requestId"].stage
    .$post({ param: { requestId: request.id } })
    .catch(() => null)
  if (!res?.ok) {
    toast.error("Couldn't show that in Lor's window")
    void queryClient.invalidateQueries({ queryKey })
  }
}
