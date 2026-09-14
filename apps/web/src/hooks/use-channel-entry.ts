import { useCallback, useEffect, useState } from "react"
import { useUnread } from "@/context/unread-context"
import { apiClient } from "@/lib/api-client"

type ChannelEntry = {
  channelId: string
  firstUnreadMessageId: string | null
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
    ready: firstUnreadMessageId !== undefined,
    resume: true,
  }
}

export function useChannelEntry(workspaceSlug: string, channelId: string) {
  const { getFirstUnreadMessageId } = useUnread()
  const firstUnreadMessageId = getFirstUnreadMessageId(channelId)
  const [entry, setEntry] = useState(() =>
    captureEntry(channelId, firstUnreadMessageId)
  )

  // Capture synchronously so cached channels start at the boundary on their
  // first render. Live/read updates must not move it during this visit.
  let currentEntry = entry
  if (
    entry.channelId !== channelId ||
    (!entry.ready && firstUnreadMessageId !== undefined)
  ) {
    currentEntry = captureEntry(channelId, firstUnreadMessageId)
    setEntry(currentEntry)
  }

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
          ? { ...current, firstUnreadMessageId: position, ready: true }
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
    anchor: currentEntry.resume ? currentEntry.firstUnreadMessageId : null,
    jumpToPresent,
  }
}
