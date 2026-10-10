import type { InferResponseType } from "@repo/api-client"
import type { RealtimeLoop, ServerToClientEvents } from "@repo/realtime-types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export type ChannelLoop = RealtimeLoop

export type LoopRun = InferResponseType<
  (typeof apiClient.v1.loops)[":loopId"]["runs"]["$get"],
  200
>["runs"][number]

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
// useChannelPlans. One query per channel feeds every loop card.
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
      // A status/lastRun flip usually means a run started or settled —
      // refresh the history lazily (only refetches while the panel shows it).
      queryClient.invalidateQueries({
        queryKey: ["loop-runs", payload.loop.id],
      })
    }
    const handleLoopDeleted: ServerToClientEvents["loop:deleted"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      queryClient.setQueryData(
        ["channel-loops", channelId],
        (existing: ChannelLoop[] | undefined) =>
          existing?.filter((l) => l.id !== payload.loopId)
      )
      queryClient.removeQueries({ queryKey: ["loop-runs", payload.loopId] })
    }
    socket.on("loop:updated", handleLoopUpdated)
    socket.on("loop:deleted", handleLoopDeleted)
    return () => {
      socket.off("loop:updated", handleLoopUpdated)
      socket.off("loop:deleted", handleLoopDeleted)
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

// Run history for the loop detail panel, newest scheduled fire first.
// The loop's recent runs, plus its session (where each run answered).
export function useLoopRuns(loopId: string | null) {
  return useQuery({
    queryKey: ["loop-runs", loopId ?? ""],
    enabled: loopId !== null,
    queryFn: async (): Promise<{
      sessionId: string | null
      runs: LoopRun[]
    }> => {
      const res = await apiClient.v1.loops[":loopId"].runs.$get({
        param: { loopId: loopId ?? "" },
      })
      if (!res.ok) throw new Error("Failed to fetch loop runs")
      return res.json()
    },
  })
}
