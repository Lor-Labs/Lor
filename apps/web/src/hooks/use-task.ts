import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

export type TaskApproval = {
  id: string
  taskId: string | null
  action: string
  description: string
  status: "pending" | "approved" | "rejected" | "expired"
  resolvedBy: string | null
  resolvedAt: string | null
  createdAt: string
}

export function taskQueryOptions(taskId: string) {
  return {
    queryKey: ["task", taskId] as const,
    queryFn: async () => {
      const res = await apiClient.v1.tasks[":taskId"].$get({
        param: { taskId },
      })
      if (!res.ok) throw new Error("Failed to fetch task")
      return res.json()
    },
  }
}

export function useTask(taskId: string | null) {
  return useQuery({
    ...taskQueryOptions(taskId ?? ""),
    enabled: taskId !== null,
  })
}

export type TaskArtifact = {
  id: string
  workspaceId: string
  channelId: string
  taskId: string | null
  path: string
  mime: string
  currentVersion: number
  url: string | null
  size: number | null
  createdAt: string
  updatedAt: string
}

export function taskArtifactsQueryOptions(taskId: string) {
  return {
    queryKey: ["task-artifacts", taskId] as const,
    queryFn: async (): Promise<TaskArtifact[]> => {
      const res = await apiClient.v1.tasks[":taskId"].artifacts.$get({
        param: { taskId },
      })
      if (!res.ok) throw new Error("Failed to fetch task artifacts")
      const payload = await res.json()
      return payload.artifacts
    },
  }
}

export function useTaskArtifacts(taskId: string | null) {
  return useQuery({
    ...taskArtifactsQueryOptions(taskId ?? ""),
    enabled: taskId !== null,
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
        apiClient.v1.approvals[":approvalId"][
          args.resolution === "approve" ? "approve" : "reject"
        ]
      const res = await endpoint.$post({
        param: { approvalId: args.approvalId },
      })
      if (!res.ok) throw new Error("Failed to resolve approval")
      return res.json()
    },
    onError: (_err, args) => {
      toast.error(
        args.resolution === "approve"
          ? "Couldn't approve — try again"
          : "Couldn't reject — try again"
      )
    },
    onSettled: () => {
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: ["task", taskId] })
      }
    },
  })
}
