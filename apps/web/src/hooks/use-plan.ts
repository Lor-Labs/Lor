import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

export type PlanApproval = {
  id: string
  planId: string | null
  action: string
  description: string
  status: "pending" | "approved" | "rejected" | "expired"
  target: string | null
  toolName: string | null
  resolver: {
    kind: "permission" | "role" | "user" | "any_member"
    role?: string
    userId?: string
  } | null
  resolverUserName: string | null
  resolvedBy: string | null
  resolvedAt: string | null
  createdAt: string
}

export function planQueryOptions(planId: string) {
  return {
    queryKey: ["plan", planId] as const,
    queryFn: async () => {
      const res = await apiClient.v1.plans[":planId"].$get({
        param: { planId },
      })
      if (!res.ok) throw new Error("Failed to fetch plan")
      return res.json()
    },
  }
}

export function usePlan(planId: string | null) {
  return useQuery({
    ...planQueryOptions(planId ?? ""),
    enabled: planId !== null,
  })
}

export type PlanArtifact = {
  id: string
  workspaceId: string
  channelId: string
  planId: string | null
  path: string
  mime: string
  currentVersion: number
  url: string | null
  size: number | null
  createdAt: string
  updatedAt: string
}

export function planArtifactsQueryOptions(planId: string) {
  return {
    queryKey: ["plan-artifacts", planId] as const,
    queryFn: async (): Promise<PlanArtifact[]> => {
      const res = await apiClient.v1.plans[":planId"].artifacts.$get({
        param: { planId },
      })
      if (!res.ok) throw new Error("Failed to fetch plan artifacts")
      const payload = await res.json()
      return payload.artifacts
    },
  }
}

export function usePlanArtifacts(planId: string | null) {
  return useQuery({
    ...planArtifactsQueryOptions(planId ?? ""),
    enabled: planId !== null,
  })
}
