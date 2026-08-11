import type { ServerToClientEvents } from "@repo/realtime-types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { Alert } from "react-native"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"
import type { ChannelTask, TaskArtifact, TaskDetail } from "@/lib/api-types"

// Channel task list, kept live by task:updated (channel room; the channel
// screen's message hook already joins it). Mirrors web's use-channel-tasks.
export function useChannelTasks(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ["channel-tasks", channelId],
    enabled: channelId.length > 0,
    queryFn: async (): Promise<ChannelTask[]> => {
      const res = await api.v1.channels[":channelId"].tasks.$get({
        param: { channelId },
        query: {},
      })
      if (!res.ok) throw new Error("Failed to fetch channel tasks")
      const payload = await res.json()
      return payload.tasks
    },
  })

  useEffect(() => {
    if (!socket || !channelId) return
    const handleTaskUpdated: ServerToClientEvents["task:updated"] = (
      payload
    ) => {
      if (payload.task.channelId !== channelId) return
      queryClient.setQueryData(
        ["channel-tasks", channelId],
        (existing: ChannelTask[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((t) => t.id !== payload.task.id)
          return [payload.task, ...rest]
        }
      )
      // Status flips change what the detail view shows (pending approval,
      // fresh artifacts) — refetch those lazily.
      void queryClient.invalidateQueries({
        queryKey: ["task", payload.task.id],
      })
      void queryClient.invalidateQueries({
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

export function useTask(taskId: string | null) {
  return useQuery({
    queryKey: ["task", taskId ?? ""],
    enabled: taskId !== null,
    queryFn: async (): Promise<TaskDetail> => {
      const res = await api.v1.tasks[":taskId"].$get({
        param: { taskId: taskId ?? "" },
      })
      if (!res.ok) throw new Error("Failed to fetch task")
      return res.json()
    },
  })
}

export function useTaskArtifacts(taskId: string | null) {
  return useQuery({
    queryKey: ["task-artifacts", taskId ?? ""],
    enabled: taskId !== null,
    queryFn: async (): Promise<TaskArtifact[]> => {
      const res = await api.v1.tasks[":taskId"].artifacts.$get({
        param: { taskId: taskId ?? "" },
      })
      if (!res.ok) throw new Error("Failed to fetch task artifacts")
      const payload = await res.json()
      return payload.artifacts
    },
  })
}

// Approve/reject a pending approval. The server posts the resolution into the
// task thread and starts the continuation run; task:updated refreshes the UI.
export function useResolveApproval(taskId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      approvalId: string
      resolution: "approve" | "reject"
    }) => {
      const endpoint =
        api.v1.approvals[":approvalId"][
          args.resolution === "approve" ? "approve" : "reject"
        ]
      const res = await endpoint.$post({
        param: { approvalId: args.approvalId },
      })
      if (!res.ok) throw new Error("Failed to resolve approval")
      return res.json()
    },
    onError: (_error, args) => {
      Alert.alert(
        args.resolution === "approve" ? "Couldn't approve" : "Couldn't reject",
        "Please try again in a moment."
      )
    },
    onSettled: () => {
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: ["task", taskId] })
      }
    },
  })
}
