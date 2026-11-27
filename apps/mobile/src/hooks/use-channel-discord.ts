import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"

// Where a Discord place is (reference/agents-and-chats.md, decision 51):
// its server, channel and link. Refetched when the link changes.
export function useChannelDiscord(
  workspaceSlug: string,
  channelId: string,
  enabled: boolean
) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const key = ["channel", workspaceSlug, channelId, "discord"] as const
  useEffect(() => {
    if (!socket || !enabled) return
    const onUpdated = (payload: { channelId: string }) => {
      if (payload.channelId !== channelId) return
      void queryClient.invalidateQueries({
        queryKey: ["channel", workspaceSlug, channelId, "discord"],
      })
    }
    socket.on("channel:discord:updated", onUpdated)
    return () => {
      socket.off("channel:discord:updated", onUpdated)
    }
  }, [socket, queryClient, workspaceSlug, channelId, enabled])
  return useQuery({
    queryKey: key,
    enabled: enabled && Boolean(workspaceSlug && channelId),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].discord.$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Couldn't load the Discord link")
      return res.json()
    },
  })
}
