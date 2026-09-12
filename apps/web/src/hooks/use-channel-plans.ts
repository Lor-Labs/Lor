import type { RealtimePlan, ServerToClientEvents } from "@repo/realtime-types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export type ChannelPlan = RealtimePlan

export const ACTIVE_PLAN_STATUSES: ChannelPlan["status"][] = [
  "running",
  "waiting_for_input",
  "waiting_for_approval",
]

export function channelPlansQueryOptions(channelId: string) {
  return {
    queryKey: ["channel-plans", channelId] as const,
    queryFn: async (): Promise<ChannelPlan[]> => {
      const res = await apiClient.v1.channels[":channelId"].plans.$get({
        param: { channelId },
        query: {},
      })
      if (!res.ok) throw new Error("Failed to fetch channel plans")
      const payload = await res.json()
      return payload.plans
    },
  }
}

// Channel plan list, kept live by plan:updated (channel room). One query per
// channel feeds every card plus the header chip.
export function useChannelPlans(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery(channelPlansQueryOptions(channelId))

  useEffect(() => {
    if (!socket) return
    const handlePlanUpdated: ServerToClientEvents["plan:updated"] = (
      payload
    ) => {
      if (payload.plan.channelId !== channelId) return
      // Cold cache: the list hasn't resolved yet, so patching would drop the
      // event (a terminal status lost this way spins forever) — refetch.
      const existing = queryClient.getQueryData<ChannelPlan[]>([
        "channel-plans",
        channelId,
      ])
      if (!existing) {
        void queryClient.invalidateQueries({
          queryKey: ["channel-plans", channelId],
        })
      } else {
        queryClient.setQueryData(
          ["channel-plans", channelId],
          [payload.plan, ...existing.filter((t) => t.id !== payload.plan.id)]
        )
      }
      // Status flips change what the detail view shows (pending approval,
      // fresh artifacts) — refetch those lazily.
      queryClient.invalidateQueries({ queryKey: ["plan", payload.plan.id] })
      queryClient.invalidateQueries({
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

// Plan anchored to a thread — the panel re-skin predicate: a thread is a plan
// thread iff a plan row exists for its root.
export function usePlanForThread(
  channelId: string,
  threadRootId: string
): ChannelPlan | null {
  const { data } = useChannelPlans(channelId)
  return data?.find((t) => t.threadRootId === threadRootId) ?? null
}
