import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { channelDetailQueryOptions } from "@/hooks/use-channel-detail"
import { prefetchChannelMessages } from "@/hooks/use-channel-messages"
import type { ChannelList } from "@/lib/api-types"
import { openTextChannels } from "@/lib/workspace-channels"

// Channels warmed at once; the screen in view gets the network first.
const CONCURRENCY = 3
const START_DELAY_MS = 1_000
const MAX_CHANNELS = 50

// Warms every open text channel's details and latest messages once the
// channel list loads, in sidebar order, so a first visit renders at once
// instead of behind a spinner. Only channels with nothing cached are fetched;
// a visit still refreshes in the background.
export function usePrefetchChannels(
  workspaceSlug: string,
  channels: ChannelList | undefined
) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!workspaceSlug || !channels) return
    const queue = openTextChannels(channels).slice(0, MAX_CHANNELS)
    let cancelled = false
    const worker = async () => {
      for (let channel = queue.shift(); channel; channel = queue.shift()) {
        if (cancelled) return
        await Promise.allSettled([
          queryClient.ensureQueryData(
            channelDetailQueryOptions(workspaceSlug, channel.id)
          ),
          prefetchChannelMessages(queryClient, workspaceSlug, channel.id),
        ])
      }
    }
    const timer = setTimeout(() => {
      for (let i = 0; i < CONCURRENCY; i++) void worker()
    }, START_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [workspaceSlug, channels, queryClient])
}
