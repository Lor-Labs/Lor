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

export const agentLoopsKey = (agentId: string) =>
  ["agent-loops", agentId] as const

// The Loops an agent runs, in every chat this person can see
// (reference/agents-and-chats.md §9: a Loop belongs to its agent). Loop
// events reach only the chats this client is in, so the list is also read
// again each time it is shown.
export function useAgentLoops(workspaceSlug: string, agentId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: agentLoopsKey(agentId),
    queryFn: async (): Promise<ChannelLoop[]> => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].loops.$get({ param: { workspaceSlug, agentId } })
      if (!res.ok) throw new Error("Failed to fetch the agent's loops")
      return (await res.json()).loops
    },
    refetchOnMount: "always",
  })

  useEffect(() => {
    if (!socket) return
    // A Loop handed to another agent changes two lists, so every agent's
    // list is read again.
    const refresh = () =>
      void queryClient.invalidateQueries({ queryKey: ["agent-loops"] })
    socket.on("loop:updated", refresh)
    socket.on("loop:deleted", refresh)
    return () => {
      socket.off("loop:updated", refresh)
      socket.off("loop:deleted", refresh)
    }
  }, [socket, queryClient])

  return query
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
