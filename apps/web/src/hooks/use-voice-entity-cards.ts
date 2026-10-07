import type {
  RealtimeVoiceBlock,
  VoiceRequestState,
} from "@repo/realtime-types/events"
import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import { isSimulatedRequest } from "@/lib/lor-simulation"

// Cards stay live while they're on screen, without a webhook per connector.
const REFRESH_MS = 60_000

// The references a result's entity blocks name; a new result with other
// references gets its own query.
export function entityRefsKey(blocks: RealtimeVoiceBlock[]) {
  return blocks
    .flatMap((block) =>
      block.type === "linear_issues"
        ? block.issues
        : block.type === "github_pull_requests"
          ? block.pullRequests
          : []
    )
    .join(",")
}

export function voiceEntityCardsQueryKey(requestId: string, refs: string) {
  return ["voice-entity-cards", requestId, refs] as const
}

async function fetchCards(requestId: string) {
  const res = await apiClient.v1.voice.requests[":requestId"].entities.$get({
    param: { requestId },
  })
  if (!res.ok) throw new Error("Failed to load cards")
  return (await res.json()).cards
}

export type VoiceEntityCards = Awaited<ReturnType<typeof fetchCards>>

// `live`: refresh while shown (Lor's window); the transcript loads once.
export function useVoiceEntityCards(request: VoiceRequestState, live: boolean) {
  const refs = entityRefsKey(request.result?.blocks ?? [])
  return useQuery({
    queryKey: voiceEntityCardsQueryKey(request.id, refs),
    // The simulator seeds its cards into the cache instead.
    enabled: refs !== "" && !isSimulatedRequest(request),
    refetchInterval: live ? REFRESH_MS : false,
    queryFn: () => fetchCards(request.id),
  })
}
