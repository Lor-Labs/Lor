import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

async function fetchSummaryCard(messageId: string) {
  const res = await apiClient.v1.voice["summary-cards"][":messageId"].$get({
    param: { messageId },
  })
  if (!res.ok) throw new Error("Failed to load the summary")
  return res.json()
}

export type SummaryCard = Awaited<ReturnType<typeof fetchSummaryCard>>
export type CallSummaryContent = NonNullable<SummaryCard["summary"]>

const summaryCardKey = (messageId: string) => ["voice-summary-card", messageId]

// Lor's summary card in a call chat, by the card message's id.
export function useSummaryCard(messageId: string) {
  return useQuery({
    queryKey: summaryCardKey(messageId),
    queryFn: () => fetchSummaryCard(messageId),
  })
}

export function useSaveSummaryCard(messageId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (summary: CallSummaryContent) => {
      const res = await apiClient.v1.voice["summary-cards"][":messageId"].$put({
        param: { messageId },
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
    onSuccess: (card) => {
      queryClient.setQueryData(summaryCardKey(messageId), card)
    },
  })
}
