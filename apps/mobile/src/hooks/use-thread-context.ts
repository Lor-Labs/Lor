import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { api } from "@/lib/api"

// How full the model's context window is for a session, for the composer's
// meter. Mirrors web's use-thread-context.ts.

async function fetchThreadContext(scopeKey: string) {
  const res = await api.v1.runs.context[":scopeKey"].$get({
    param: { scopeKey },
  })
  if (!res.ok) throw new Error("Couldn't load context usage")
  return res.json()
}

export type ThreadContextUsage = Awaited<ReturnType<typeof fetchThreadContext>>

// Polls on its own rather than following the socket, so a missed final
// frame or a late checkpoint can't freeze the meter.
export function useThreadContext(
  scopeKey: string | undefined,
  isRunning: boolean
) {
  const query = useQuery({
    queryKey: ["thread-context", scopeKey],
    queryFn: () => fetchThreadContext(scopeKey ?? ""),
    enabled: Boolean(scopeKey),
    staleTime: 15_000,
    refetchInterval: (current) => {
      const state = current.state.data?.state
      return isRunning ||
        state === "queued" ||
        state === "working" ||
        state === "finalizing"
        ? 10_000
        : 30_000
    },
  })

  const { refetch } = query
  // A run starting or stopping refreshes it; the checkpoint can land after
  // the UI settles, which the polling then picks up.
  useEffect(() => {
    if (!scopeKey) return
    void refetch()
  }, [isRunning, scopeKey, refetch])

  return query
}
