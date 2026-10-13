import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useInvalidateOnVoiceUpdate } from "@/hooks/use-voice-presence"
import { apiClient } from "@/lib/api-client"

async function fetchCallSummary(sessionId: string) {
  const res = await apiClient.v1.voice.sessions[":sessionId"].summary.$get({
    param: { sessionId },
  })
  if (!res.ok) throw new Error("Failed to load the summary")
  return res.json()
}

export type CallSummary = Awaited<ReturnType<typeof fetchCallSummary>>
export type CallSummaryContent = NonNullable<CallSummary["summary"]>

const callSummaryKey = (sessionId: string | null) =>
  ["voice-summary", sessionId] as const

// An ended call's summary, for its Summary tab. Voice pushes refetch it: the
// after-call job finishing, or someone's correction.
export function useCallSummary(sessionId: string | null) {
  useInvalidateOnVoiceUpdate("voice-summary", sessionId ?? undefined, undefined)
  return useQuery({
    queryKey: callSummaryKey(sessionId),
    queryFn: sessionId ? () => fetchCallSummary(sessionId) : skipToken,
  })
}

export function useSaveCallSummary(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (summary: CallSummaryContent) => {
      const res = await apiClient.v1.voice.sessions[":sessionId"].summary.$put({
        param: { sessionId },
        json: summary,
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(
          "message" in body ? body.message : "Couldn't save the summary"
        )
      }
      return body
    },
    onSuccess: (summary) => {
      queryClient.setQueryData(callSummaryKey(sessionId), summary)
    },
  })
}
