import type { RealtimeTask, ServerToClientEvents } from "@repo/realtime-types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export type ChannelTask = RealtimeTask

export const ACTIVE_TASK_STATUSES: ChannelTask["status"][] = [
  "running",
  "waiting_for_input",
  "waiting_for_approval",
]

export function channelTasksQueryOptions(channelId: string) {
  return {
    queryKey: ["channel-tasks", channelId] as const,
    queryFn: async (): Promise<ChannelTask[]> => {
      const res = await apiClient.v1.channels[":channelId"].tasks.$get({
        param: { channelId },
        query: {},
      })
      if (!res.ok) throw new Error("Failed to fetch channel tasks")
      const payload = await res.json()
      return payload.tasks
    },
  }
}

// Channel task list, kept live by task:updated (channel room). One query per
// channel feeds every card plus the header chip.
export function useChannelTasks(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery(channelTasksQueryOptions(channelId))

  useEffect(() => {
    if (!socket) return
    const handleTaskUpdated: ServerToClientEvents["task:updated"] = (
      payload
    ) => {
      if (payload.task.channelId !== channelId) return
      // Cold cache: the list hasn't resolved yet, so patching would drop the
      // event (a terminal status lost this way spins forever) — refetch.
      const existing = queryClient.getQueryData<ChannelTask[]>([
        "channel-tasks",
        channelId,
      ])
      if (!existing) {
        void queryClient.invalidateQueries({
          queryKey: ["channel-tasks", channelId],
        })
      } else {
        queryClient.setQueryData(
          ["channel-tasks", channelId],
          [payload.task, ...existing.filter((t) => t.id !== payload.task.id)]
        )
      }
      // Status flips change what the detail view shows (pending approval,
      // fresh artifacts) — refetch those lazily.
      queryClient.invalidateQueries({ queryKey: ["task", payload.task.id] })
      queryClient.invalidateQueries({
        queryKey: ["task-artifacts", payload.task.id],
      })
    }
    socket.on("task:updated", handleTaskUpdated)
    return () => {
      socket.off("task:updated", handleTaskUpdated)
    }
  }, [socket, queryClient, channelId])

  return query
}

export function useTaskForCard(
  channelId: string,
  cardMessageId: string
): ChannelTask | null {
  const { data } = useChannelTasks(channelId)
  return data?.find((t) => t.cardMessageId === cardMessageId) ?? null
}
