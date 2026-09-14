import type {
  NotificationBootstrap,
  UnreadNotification,
} from "@repo/realtime-types"
import { useCallback, useEffect, useState } from "react"
import { useSocket } from "@/context/socket-context"
import { useUnread } from "@/context/unread-context"
import { apiClient } from "@/lib/api-client"
import { isAppFocused, subscribeAppFocus } from "@/lib/app-focus"

type ChannelEntry = {
  channelId: string
  firstUnreadMessageId: string | null
  anchorMessageId: string | null
  ready: boolean
  resume: boolean
}

function captureEntry(
  channelId: string,
  firstUnreadMessageId: string | null | undefined
): ChannelEntry {
  return {
    channelId,
    firstUnreadMessageId: firstUnreadMessageId ?? null,
    anchorMessageId: firstUnreadMessageId ?? null,
    ready: firstUnreadMessageId !== undefined,
    resume: true,
  }
}

export function useChannelEntry(workspaceSlug: string, channelId: string) {
  const socket = useSocket()
  const { getFirstUnreadMessageId } = useUnread()
  const firstUnreadMessageId = getFirstUnreadMessageId(channelId)
  const [entry, setEntry] = useState(() =>
    captureEntry(channelId, firstUnreadMessageId)
  )

  // Capture synchronously so cached channels start at the boundary on their
  // first render. Keep the scroll anchor separate from the live divider.
  let currentEntry = entry
  if (
    entry.channelId !== channelId ||
    (!entry.ready && firstUnreadMessageId !== undefined)
  ) {
    currentEntry = captureEntry(channelId, firstUnreadMessageId)
    setEntry(currentEntry)
  }

  useEffect(() => {
    let wasFocused = isAppFocused()
    let capturedAwayBoundary = false
    let awaitingAwaySnapshot = !wasFocused
    const unsubscribeFocus = subscribeAppFocus((focused) => {
      if (wasFocused && !focused) {
        capturedAwayBoundary = false
        awaitingAwaySnapshot = true
      }
      wasFocused = focused
    })
    const captureAwayBoundary = (
      messageId: string | null | undefined,
      recoveringAwayMessages = false
    ) => {
      const focused = isAppFocused()
      if (!messageId || (focused && !recoveringAwayMessages)) return
      if (wasFocused && !focused) capturedAwayBoundary = false
      wasFocused = focused
      if (capturedAwayBoundary) return
      capturedAwayBoundary = true
      setEntry((current) =>
        current.channelId === channelId && current.ready
          ? { ...current, firstUnreadMessageId: messageId }
          : current
      )
    }
    const onUnread = (payload: UnreadNotification) => {
      if (
        payload.channelId !== channelId ||
        payload.threadRootId ||
        payload.messageType === "event"
      )
        return
      captureAwayBoundary(payload.messageId)
    }
    const onBootstrap = (payload: NotificationBootstrap) => {
      // A suspended app may only receive its missed messages after refocusing.
      captureAwayBoundary(
        payload.readStates.find((state) => state.channelId === channelId)
          ?.firstUnreadMessageId,
        awaitingAwaySnapshot
      )
      awaitingAwaySnapshot = false
    }
    socket?.on("notification:unread", onUnread)
    socket?.on("notification:bootstrap", onBootstrap)
    return () => {
      unsubscribeFocus()
      socket?.off("notification:unread", onUnread)
      socket?.off("notification:bootstrap", onBootstrap)
    }
  }, [channelId, socket])

  useEffect(() => {
    if (currentEntry.ready) return
    const controller = new AbortController()

    async function fetchUnknownPosition() {
      let position: string | null = null
      try {
        const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
          ":channelId"
        ]["read-position"].$get(
          { param: { workspaceSlug, channelId } },
          {
            init: {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(10_000),
              ]),
            },
          }
        )
        if (res.ok) position = (await res.json()).firstUnreadMessageId
      } catch {
        // Missing bootstrap/offline recovery must not block channel rendering.
      }
      if (controller.signal.aborted) return
      setEntry((current) =>
        current.channelId === channelId && !current.ready
          ? {
              ...current,
              firstUnreadMessageId: position,
              anchorMessageId: position,
              ready: true,
            }
          : current
      )
    }

    void fetchUnknownPosition()
    return () => controller.abort()
  }, [workspaceSlug, channelId, currentEntry.ready])

  const jumpToPresent = useCallback(() => {
    setEntry((current) =>
      current.channelId === channelId ? { ...current, resume: false } : current
    )
  }, [channelId])

  return {
    ready: currentEntry.ready,
    firstUnreadMessageId: currentEntry.firstUnreadMessageId,
    anchor: currentEntry.resume ? currentEntry.anchorMessageId : null,
    jumpToPresent,
  }
}
