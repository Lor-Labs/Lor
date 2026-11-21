import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export const channelDiscordKey = (workspaceSlug: string, channelId: string) =>
  ["channel", workspaceSlug, channelId, "discord"] as const

// Where a channel's chat lives: Lor, or a linked Discord channel
// (reference/always-on-agents.md §10). Refetched when a link is made or
// removed from either side.
export function useChannelDiscord(
  workspaceSlug: string | undefined,
  channelId: string,
  enabled = true
) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const key = channelDiscordKey(workspaceSlug ?? "", channelId)
  useEffect(() => {
    if (!socket || !workspaceSlug) return
    const onUpdated = (payload: { channelId: string }) => {
      if (payload.channelId !== channelId) return
      void queryClient.invalidateQueries({
        queryKey: channelDiscordKey(workspaceSlug, channelId),
      })
    }
    socket.on("channel:discord:updated", onUpdated)
    return () => {
      socket.off("channel:discord:updated", onUpdated)
    }
  }, [socket, workspaceSlug, channelId, queryClient])
  return useQuery({
    queryKey: key,
    enabled: Boolean(enabled && workspaceSlug && channelId),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].discord.$get({
        param: { workspaceSlug: workspaceSlug ?? "", channelId },
      })
      if (!res.ok) throw new Error("Failed to load the Discord link")
      return res.json()
    },
  })
}
