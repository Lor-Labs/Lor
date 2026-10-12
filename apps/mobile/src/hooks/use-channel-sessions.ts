import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { sidebarSessionMutationKey } from "@/hooks/use-workspace-activity"
import { api } from "@/lib/api"

// Same key as web.
export const channelSessionsKey = (channelId: string) =>
  ["channel-sessions", channelId] as const

async function fetchChannelSessions(channelId: string, archived: boolean) {
  const res = await api.v1.channels[":channelId"].sessions.$get({
    param: { channelId },
    query: { archived: archived ? "true" : "false" },
  })
  if (!res.ok) throw new Error("Failed to load sessions")
  const body = await res.json()
  return body.sessions
}

export type ChannelSession = Awaited<
  ReturnType<typeof fetchChannelSessions>
>[number]

// Everyone's sessions in a channel. New sessions, runs, titles and archives
// all push workspace activity, which refreshes the open list. Mirrors web's
// use-channel-sessions.ts.
export function useChannelSessions(channelId: string, archived: boolean) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    // Waits while a session change is in flight, like the Channels tab.
    const refresh = () => {
      if (
        queryClient.isMutating({ mutationKey: sidebarSessionMutationKey }) > 0
      ) {
        return
      }
      void queryClient.invalidateQueries({
        queryKey: channelSessionsKey(channelId),
      })
    }
    socket.on("workspace:activity:updated", refresh)
    return () => {
      socket.off("workspace:activity:updated", refresh)
    }
  }, [socket, queryClient, channelId])

  return useQuery({
    queryKey: [
      ...channelSessionsKey(channelId),
      archived ? "archived" : "active",
    ],
    enabled: Boolean(channelId),
    queryFn: () => fetchChannelSessions(channelId, archived),
  })
}
