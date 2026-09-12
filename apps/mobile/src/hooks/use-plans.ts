import type { ServerToClientEvents } from "@repo/realtime-types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"
import type { ChannelPlan, PlanArtifact, PlanDetail } from "@/lib/api-types"

// Channel plan list, kept live by plan:updated (channel room; the channel
// screen's message hook already joins it). Mirrors web's use-channel-plans.
export function useChannelPlans(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ["channel-plans", channelId],
    enabled: channelId.length > 0,
    queryFn: async (): Promise<ChannelPlan[]> => {
      const res = await api.v1.channels[":channelId"].plans.$get({
        param: { channelId },
        query: {},
      })
      if (!res.ok) throw new Error("Failed to fetch channel plans")
      const payload = await res.json()
      return payload.plans
    },
  })

  useEffect(() => {
    if (!socket || !channelId) return
    const handlePlanUpdated: ServerToClientEvents["plan:updated"] = (
      payload
    ) => {
      if (payload.plan.channelId !== channelId) return
      if (!queryClient.getQueryData(["channel-plans", channelId])) {
        void queryClient.invalidateQueries({
          queryKey: ["channel-plans", channelId],
        })
      }
      queryClient.setQueryData(
        ["channel-plans", channelId],
        (existing: ChannelPlan[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((t) => t.id !== payload.plan.id)
          return [payload.plan, ...rest]
        }
      )
      // Status flips change what the detail view shows (pending approval,
      // fresh artifacts) — refetch those lazily.
      void queryClient.invalidateQueries({
        queryKey: ["plan", payload.plan.id],
      })
      void queryClient.invalidateQueries({
        queryKey: ["plan-artifacts", payload.plan.id],
      })
    }
    socket.on("plan:updated", handlePlanUpdated)
    return () => {
      socket.off("plan:updated", handlePlanUpdated)
    }
  }, [socket, queryClient, channelId])

  return query
}

export function usePlanForCard(
  channelId: string,
  cardMessageId: string
): ChannelPlan | null {
  const { data } = useChannelPlans(channelId)
  return data?.find((t) => t.cardMessageId === cardMessageId) ?? null
}

// Plan anchored to a thread — the screen re-skin predicate: a thread is a plan
// thread iff a plan row exists for its root. Mirrors web.
export function usePlanForThread(
  channelId: string,
  threadRootId: string
): ChannelPlan | null {
  const { data } = useChannelPlans(channelId)
  return data?.find((t) => t.threadRootId === threadRootId) ?? null
}

export function usePlan(planId: string | null) {
  return useQuery({
    queryKey: ["plan", planId ?? ""],
    enabled: planId !== null,
    queryFn: async (): Promise<PlanDetail> => {
      const res = await api.v1.plans[":planId"].$get({
        param: { planId: planId ?? "" },
      })
      if (!res.ok) throw new Error("Failed to fetch plan")
      return res.json()
    },
  })
}

export function usePlanArtifacts(planId: string | null) {
  return useQuery({
    queryKey: ["plan-artifacts", planId ?? ""],
    enabled: planId !== null,
    queryFn: async (): Promise<PlanArtifact[]> => {
      const res = await api.v1.plans[":planId"].artifacts.$get({
        param: { planId: planId ?? "" },
      })
      if (!res.ok) throw new Error("Failed to fetch plan artifacts")
      const payload = await res.json()
      return payload.artifacts
    },
  })
}
