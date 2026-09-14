import type { RealtimeMessage } from "@repo/realtime-types"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { useUnread } from "@/context/unread-context"
import { isAppFocused, subscribeAppFocus } from "@/lib/app-focus"

const DEBOUNCE_MS = 1000

export function useAutoMarkRead(channelId: string | undefined) {
  const { markChannelRead } = useUnread()
  const socket = useSocket()

  useEffect(() => {
    if (!channelId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancelMarkRead = () => {
      clearTimeout(timer)
      timer = undefined
    }
    const scheduleMarkRead = () => {
      cancelMarkRead()
      if (!isAppFocused()) return
      timer = setTimeout(() => {
        // Losing focus during the debounce must not consume unseen messages.
        if (isAppFocused()) markChannelRead(channelId)
      }, DEBOUNCE_MS)
    }
    const unsubscribeFocus = subscribeAppFocus((focused) => {
      if (focused) scheduleMarkRead()
      else cancelMarkRead()
    })
    const onMessageCreated = (message: RealtimeMessage) => {
      if (message.channelId === channelId) scheduleMarkRead()
    }
    // Thread replies only broadcast to their own room; the channel receives
    // the summary event instead. Per-thread read state remains separate.
    const onThreadUpdated = (payload: { channelId: string }) => {
      if (payload.channelId === channelId) scheduleMarkRead()
    }

    scheduleMarkRead()
    socket?.on("message:created", onMessageCreated)
    socket?.on("message:thread:updated", onThreadUpdated)
    socket?.on("notification:bootstrap", scheduleMarkRead)
    return () => {
      cancelMarkRead()
      unsubscribeFocus()
      socket?.off("message:created", onMessageCreated)
      socket?.off("message:thread:updated", onThreadUpdated)
      socket?.off("notification:bootstrap", scheduleMarkRead)
    }
  }, [channelId, socket, markChannelRead])
}
