import type { InferResponseType } from "@repo/api-client"
import type { ServerToClientEvents } from "@repo/realtime-types"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export type ChannelFile = InferResponseType<
  (typeof apiClient.v1.channels)[":channelId"]["files"]["$get"],
  200
>["files"][number]

export function useChannelFiles(
  channelId: string,
  q = "",
  kind: "all" | "artifact" | "upload" = "all"
) {
  return useInfiniteQuery({
    queryKey: ["channel-files", channelId, kind, q],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await apiClient.v1.channels[":channelId"].files.$get({
        param: { channelId },
        query: {
          q,
          kind,
          limit: "30",
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      })
      if (!res.ok) throw new Error("Couldn't load channel files")
      return res.json()
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Thread-only and headless runs can finish outside the channel room.
    refetchInterval: 30_000,
  })
}

export function useChannelFilesRealtime(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    const refresh = () => {
      void queryClient.invalidateQueries({
        queryKey: ["channel-files", channelId],
      })
    }
    const created: ServerToClientEvents["message:created"] = (message) => {
      if (message.channelId === channelId && message.attachments?.length)
        refresh()
    }
    const deleted: ServerToClientEvents["message:deleted"] = (event) => {
      if (event.channelId !== channelId) return
      refresh()
      void queryClient.invalidateQueries({
        queryKey: ["pinned-messages", channelId],
      })
      void queryClient.invalidateQueries({ queryKey: ["artifact"] })
    }
    const finished: ServerToClientEvents["message:stream"] = (event) => {
      if (event.channelId !== channelId || !event.done) return
      refresh()
      void queryClient.invalidateQueries({ queryKey: ["artifact"] })
    }
    const loopUpdated: ServerToClientEvents["loop:updated"] = ({ loop }) => {
      if (loop.channelId === channelId) refresh()
    }
    socket.on("message:created", created)
    socket.on("message:deleted", deleted)
    socket.on("message:stream", finished)
    socket.on("loop:updated", loopUpdated)
    return () => {
      socket.off("message:created", created)
      socket.off("message:deleted", deleted)
      socket.off("message:stream", finished)
      socket.off("loop:updated", loopUpdated)
    }
  }, [socket, queryClient, channelId])
}
