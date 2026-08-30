import { useCallback, useEffect, useRef } from "react"
import { apiClient } from "@/lib/api-client"

/**
 * Persists "I read this thread" (thread_read_state) so the activity dock
 * stays cleared across reloads and other devices. Best-effort: the local
 * dismiss already happened, so failures are swallowed and retried on the
 * next call. Repeat calls for the same thread are throttled with a trailing
 * send — the server cursor is "now" at request time, so the trailing call
 * covers every reply seen during the window. Pending trailing sends are
 * flushed (not dropped) when the caller unmounts.
 */
const RESEND_INTERVAL_MS = 4000

export function useMarkThreadRead(workspaceSlug: string, channelId: string) {
  const lastSentRef = useRef(new Map<string, number>())
  const pendingTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  )

  const send = useCallback(
    (threadRootId: string) => {
      lastSentRef.current.set(threadRootId, Date.now())
      void apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].threads[":threadRootId"].read
        .$post({
          param: { workspaceSlug, channelId, threadRootId },
        })
        .catch(() => {
          lastSentRef.current.delete(threadRootId)
        })
    },
    [workspaceSlug, channelId]
  )

  useEffect(() => {
    const timers = pendingTimersRef.current
    return () => {
      for (const [threadRootId, timer] of timers) {
        clearTimeout(timer)
        send(threadRootId)
      }
      timers.clear()
    }
  }, [send])

  return useCallback(
    (threadRootId: string) => {
      const elapsed = Date.now() - (lastSentRef.current.get(threadRootId) ?? 0)
      if (elapsed >= RESEND_INTERVAL_MS) {
        send(threadRootId)
        return
      }
      if (pendingTimersRef.current.has(threadRootId)) return
      const timer = setTimeout(() => {
        pendingTimersRef.current.delete(threadRootId)
        send(threadRootId)
      }, RESEND_INTERVAL_MS - elapsed)
      pendingTimersRef.current.set(threadRootId, timer)
    },
    [send]
  )
}
