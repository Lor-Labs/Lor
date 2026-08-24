import type { RealtimeLoop, ServerToClientEvents } from "@repo/realtime-types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export type ChannelLoop = RealtimeLoop

export function channelLoopsQueryOptions(channelId: string) {
  return {
    queryKey: ["channel-loops", channelId] as const,
    queryFn: async (): Promise<ChannelLoop[]> => {
      const res = await apiClient.v1.channels[":channelId"].loops.$get({
        param: { channelId },
      })
      if (!res.ok) throw new Error("Failed to fetch channel loops")
      const payload = await res.json()
      return payload.loops
    },
  }
}

// Channel loop list, kept live by loop:updated (channel room) — mirrors
// useChannelTasks. One query per channel feeds every loop card.
export function useChannelLoops(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery(channelLoopsQueryOptions(channelId))

  useEffect(() => {
    if (!socket) return
    const handleLoopUpdated: ServerToClientEvents["loop:updated"] = (
      payload
    ) => {
      if (payload.loop.channelId !== channelId) return
      queryClient.setQueryData(
        ["channel-loops", channelId],
        (existing: ChannelLoop[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((l) => l.id !== payload.loop.id)
          return [payload.loop, ...rest]
        }
      )
    }
    socket.on("loop:updated", handleLoopUpdated)
    return () => {
      socket.off("loop:updated", handleLoopUpdated)
    }
  }, [socket, queryClient, channelId])

  return query
}

export function useLoopForCard(
  channelId: string,
  cardMessageId: string
): ChannelLoop | null {
  const { data } = useChannelLoops(channelId)
  return data?.find((l) => l.cardMessageId === cardMessageId) ?? null
}
