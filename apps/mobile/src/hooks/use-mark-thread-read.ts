import { useFocusEffect } from "expo-router"
import { useCallback, useEffect, useRef } from "react"
import { AppState } from "react-native"
import { api } from "@/lib/api"

// Repeat sends are throttled with a trailing send; the server cursor is "now"
// at request time, so the trailing call covers every reply seen meanwhile.
const RESEND_INTERVAL_MS = 4000

// An open thread or session is being read: advance the per-thread read
// cursor (thread_read_state) on focus, on each reply or Lor status change
// while it's on screen, when the app comes back and on leave. This clears a
// session's unread state on every device. Mirrors web's use-mark-thread-read.ts.
export function useMarkThreadRead({
  workspaceSlug,
  channelId,
  threadRootId,
  newestKey,
  enabled,
}: {
  workspaceSlug: string
  channelId: string
  threadRootId: string
  // Changes when a reply lands or the newest one finishes.
  newestKey: string | null
  enabled: boolean
}) {
  const focusedRef = useRef(false)
  const lastSentRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = useCallback(() => {
    if (!workspaceSlug || !channelId || !threadRootId) return
    lastSentRef.current = Date.now()
    void api.v1.workspaces[":workspaceSlug"].channels[":channelId"].threads[
      ":threadRootId"
    ].read
      .$post({ param: { workspaceSlug, channelId, threadRootId } })
      .catch(() => {
        lastSentRef.current = 0
      })
  }, [workspaceSlug, channelId, threadRootId])

  const request = useCallback(() => {
    if (!enabled || !focusedRef.current) return
    const elapsed = Date.now() - lastSentRef.current
    if (elapsed >= RESEND_INTERVAL_MS) {
      send()
      return
    }
    if (timerRef.current) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      send()
    }, RESEND_INTERVAL_MS - elapsed)
  }, [enabled, send])

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true
      request()
      return () => {
        focusedRef.current = false
        const pending = timerRef.current !== null
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = null
        // Leaving reads it up to now, so a Lor run that finishes just after
        // the last read doesn't leave the session unread. A pending send
        // flushes either way.
        if (pending || (enabled && AppState.currentState === "active")) send()
      }
    }, [enabled, request, send])
  )

  // A new reply or a finished Lor reply while on screen.
  useEffect(() => {
    request()
  }, [newestKey, request])

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") request()
    })
    return () => subscription.remove()
  }, [request])
}
