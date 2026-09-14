import { useCallback, useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"

type ChannelEntry = {
  channelId: string
  firstUnreadMessageId: string | null
  resume: boolean
}

export function useChannelEntry(workspaceSlug: string, channelId: string) {
  const [entry, setEntry] = useState<ChannelEntry>()

  useEffect(() => {
    const controller = new AbortController()
    setEntry(undefined)

    async function captureEntry() {
      let firstUnreadMessageId: string | null = null
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
        if (res.ok)
          firstUnreadMessageId = (await res.json()).firstUnreadMessageId
      } catch {
        // If the read position is unavailable, open at the latest messages.
      }
      if (controller.signal.aborted) return
      setEntry({ channelId, firstUnreadMessageId, resume: true })
    }

    void captureEntry()
    return () => controller.abort()
  }, [workspaceSlug, channelId])

  const jumpToPresent = useCallback(() => {
    setEntry((current) =>
      current?.channelId === channelId ? { ...current, resume: false } : current
    )
  }, [channelId])

  const ready = entry?.channelId === channelId
  return {
    ready,
    firstUnreadMessageId: ready ? entry.firstUnreadMessageId : null,
    anchor: ready && entry.resume ? entry.firstUnreadMessageId : null,
    jumpToPresent,
  }
}
