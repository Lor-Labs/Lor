import { skipToken, useQuery } from "@tanstack/react-query"
import { useInvalidateOnVoiceUpdate } from "@/hooks/use-voice-presence"
import { api } from "@/lib/api"

async function fetchCallSummary(sessionId: string) {
  const res = await api.v1.voice.sessions[":sessionId"].summary.$get({
    param: { sessionId },
  })
  if (!res.ok) throw new Error("Failed to load the summary")
  return res.json()
}

async function fetchSummaryCard(messageId: string) {
  const res = await api.v1.voice["summary-cards"][":messageId"].$get({
    param: { messageId },
  })
  if (!res.ok) throw new Error("Failed to load the summary")
  return res.json()
}

export type CallSummary = Awaited<ReturnType<typeof fetchCallSummary>>
export type CallSummaryContent = NonNullable<CallSummary["summary"]>

// An ended call's summary, for its Summary tab. Voice pushes refetch it: the
// after-call job finishing, or someone's correction on web. Same key as web.
export function useCallSummary(sessionId: string | null) {
  useInvalidateOnVoiceUpdate("voice-summary", sessionId ?? undefined, undefined)
  return useQuery({
    queryKey: ["voice-summary", sessionId],
    queryFn: sessionId ? () => fetchCallSummary(sessionId) : skipToken,
  })
}

// Lor's summary card in an old call's chat (before the Summary tab), by the
// card message's id, where it still shows outside the call (pins, search).
export function useSummaryCard(messageId: string) {
  return useQuery({
    queryKey: ["voice-summary-card", messageId],
    queryFn: () => fetchSummaryCard(messageId),
  })
}
