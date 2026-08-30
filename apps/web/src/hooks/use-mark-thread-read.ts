import { useCallback, useRef } from "react"
import { apiClient } from "@/lib/api-client"

/**
 * Persists "I read this thread" (thread_read_state) so the activity dock
 * stays cleared across reloads and other devices. Best-effort: the local
 * dismiss already happened, so failures are swallowed and retried on the
 * next call. Repeat calls for the same thread are throttled — the thread
 * panel re-marks on every incoming reply while open.
 */
const RESEND_INTERVAL_MS = 4000

export function useMarkThreadRead(workspaceSlug: string, channelId: string) {
  const lastSentRef = useRef(new Map<string, number>())

  return useCallback(
    (threadRootId: string) => {
      const now = Date.now()
      const lastSent = lastSentRef.current.get(threadRootId) ?? 0
      if (now - lastSent < RESEND_INTERVAL_MS) return
      lastSentRef.current.set(threadRootId, now)
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
}
