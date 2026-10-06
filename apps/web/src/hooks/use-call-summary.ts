import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

async function fetchCallSummary(sessionId: string) {
  const res = await apiClient.v1.voice.sessions[":sessionId"].summary.$get({
    param: { sessionId },
  })
  if (!res.ok) throw new Error("Failed to load the summary")
  return res.json()
}

export type CallSummaryRecord = Awaited<ReturnType<typeof fetchCallSummary>>
export type CallSummaryContent = NonNullable<CallSummaryRecord["summary"]>

const callSummaryKey = (sessionId: string) => ["voice-summary", sessionId]

// Checks back while Lor is still writing, so the summary appears without a
// reload.
export function useCallSummary(sessionId: string) {
  return useQuery({
    queryKey: callSummaryKey(sessionId),
    queryFn: () => fetchCallSummary(sessionId),
    refetchInterval: (query) =>
      query.state.data?.status === "processing" ? 10_000 : false,
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
    onSuccess: (record) => {
      queryClient.setQueryData(callSummaryKey(sessionId), record)
    },
  })
}
