import type { RealtimeMessage } from "@repo/realtime-types"
import { useFocusEffect } from "expo-router"
import { useCallback, useEffect, useRef } from "react"
import { AppState } from "react-native"
import { useSocket } from "@/context/socket-context"
import { useUnread } from "@/context/unread-context"

const DEBOUNCE_MS = 1000

export function useAutoMarkRead(channelId: string | undefined) {
  const { markChannelRead } = useUnread()
  const socket = useSocket()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedRef = useRef(false)
  const channelIdRef = useRef(channelId)
  channelIdRef.current = channelId

  const debouncedMarkRead = useCallback(() => {
    if (!channelIdRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (channelIdRef.current && focusedRef.current) {
        markChannelRead(channelIdRef.current)
      }
    }, DEBOUNCE_MS)
  }, [markChannelRead])

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true
      debouncedMarkRead()
      return () => {
        focusedRef.current = false
        if (timerRef.current) clearTimeout(timerRef.current)
      }
    }, [debouncedMarkRead])
  )

  useEffect(() => {
    if (channelId && focusedRef.current) debouncedMarkRead()
  }, [channelId, debouncedMarkRead])

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && focusedRef.current) debouncedMarkRead()
    })
    return () => subscription.remove()
  }, [debouncedMarkRead])

  // Thread replies broadcast to the thread room only, so they never hit
  // `message:created` — the lightweight `message:thread:updated` covers them.
  useEffect(() => {
    if (!socket) return

    const onMessageCreated = (message: RealtimeMessage) => {
      if (message.channelId === channelIdRef.current && focusedRef.current) {
        debouncedMarkRead()
      }
    }
    const onThreadUpdated = (payload: { channelId: string }) => {
      if (payload.channelId === channelIdRef.current && focusedRef.current) {
        debouncedMarkRead()
      }
    }

    socket.on("message:created", onMessageCreated)
    socket.on("message:thread:updated", onThreadUpdated)
    return () => {
      socket.off("message:created", onMessageCreated)
      socket.off("message:thread:updated", onThreadUpdated)
    }
  }, [socket, debouncedMarkRead])
}
