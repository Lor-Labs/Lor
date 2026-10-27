import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { apiClient } from "@/lib/api-client"

export type ThreadContextUsage = {
  available: boolean
  usedTokens: number
  windowTokens: number
  compactAtTokens: number
  segments: {
    system: number
    tools: number
    messages: number
  }
  // A Claude Code session: its own counted rows, in place of the segments.
  categories: { name: string; tokens: number }[] | null
  compacted: boolean
  rawHistoryTokens: number
  // Null for a Claude Code session, which spends no Lor credits.
  creditsSpent: number | null
  runCount: number
  state: string | null
}

// Poll independently of websocket state so missed terminal frames and late
// checkpoints cannot freeze the meter.
export function useThreadContext(
  scopeKey: string | undefined,
  isRunning: boolean
) {
  const query = useQuery({
    queryKey: ["thread-context", scopeKey],
    queryFn: async (): Promise<ThreadContextUsage> => {
      const res = await apiClient.v1.runs.context[":scopeKey"].$get({
        param: { scopeKey: scopeKey as string },
      })
      if (!res.ok) throw new Error("Couldn't load context usage")
      return (await res.json()) as ThreadContextUsage
    },
    enabled: Boolean(scopeKey),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const state = query.state.data?.state
      return isRunning ||
        state === "queued" ||
        state === "working" ||
        state === "finalizing"
        ? 10_000
        : 30_000
    },
  })

  const { refetch } = query
  useEffect(() => {
    // Without the scopeKey guard this can fire for a disabled query and request
    // /runs/context/undefined, which fails the uuid param check.
    if (!scopeKey) return
    // Refresh on both start and stop; the checkpoint may arrive after the UI settles.
    void refetch()
  }, [isRunning, scopeKey, refetch])

  return query
}
