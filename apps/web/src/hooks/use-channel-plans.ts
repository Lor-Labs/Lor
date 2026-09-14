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
    const handlePlanUpdated: ServerToClientEvents["plan:updated"] = async (
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
        // A background refetch snapshotted before this event would resolve
        // after the patch and overwrite it with the stale list — cancel first.
        await queryClient.cancelQueries({
          queryKey: ["channel-plans", channelId],
        })
        queryClient.setQueryData(
          ["channel-plans", channelId],
          [payload.plan, ...existing.filter((t) => t.id !== payload.plan.id)]
        )
      }
      void queryClient.invalidateQueries({
        queryKey: ["channel-plan", channelId],
      })
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

function usePlanForMessage(
  channelId: string,
  messageId: string,
  field: "cardMessageId" | "threadRootId"
) {
  const channelPlans = useChannelPlans(channelId)
  const recentPlan = channelPlans.data?.find(
    (plan) => plan[field] === messageId
  )
  // The channel list is capped at 50; old cards and threads need a direct lookup.
  const lookup = useQuery({
    queryKey: ["channel-plan", channelId, messageId],
    queryFn: async (): Promise<ChannelPlan | null> => {
      const res = await apiClient.v1.channels[":channelId"].plans.$get({
        param: { channelId },
        query: { messageId },
      })
      if (!res.ok) throw new Error("Failed to fetch plan details")
      const payload = await res.json()
      return (
        payload.plans.find(
          (plan) =>
            plan.cardMessageId === messageId || plan.threadRootId === messageId
        ) ?? null
      )
    },
    enabled: !recentPlan && !channelPlans.isPending,
  })
  const plan = recentPlan ?? lookup.data ?? null
  return {
    plan,
    isPending: !plan && (channelPlans.isPending || lookup.isPending),
    isError: !plan && lookup.isError,
    refetch: lookup.refetch,
  }
}

export function usePlanForCard(channelId: string, cardMessageId: string) {
  return usePlanForMessage(channelId, cardMessageId, "cardMessageId")
}

// Plan anchored to a thread — including threads older than the channel list.
export function usePlanForThread(
  channelId: string,
  threadRootId: string
): ChannelPlan | null {
  return usePlanForMessage(channelId, threadRootId, "threadRootId").plan
}
