import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

async function fetchSummaryCard(messageId: string) {
  const res = await api.v1.voice["summary-cards"][":messageId"].$get({
    param: { messageId },
  })
  if (!res.ok) throw new Error("Failed to load the summary")
  return res.json()
}

export type SummaryCard = Awaited<ReturnType<typeof fetchSummaryCard>>
export type CallSummaryContent = NonNullable<SummaryCard["summary"]>

// Lor's summary card in a call chat, by the card message's id. Same key as
// web.
export function useSummaryCard(messageId: string) {
  return useQuery({
    queryKey: ["voice-summary-card", messageId],
    queryFn: () => fetchSummaryCard(messageId),
  })
}
