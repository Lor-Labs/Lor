import type { ServerToClientEvents } from "@repo/realtime-types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { Alert } from "react-native"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"
import type { ChannelLoop } from "@/lib/api-types"

// Channel loop list, kept live by loop:updated (channel room; the channel
// screen's message hook already joins it). Mirrors web's use-channel-loops.
export function useChannelLoops(channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ["channel-loops", channelId],
    enabled: channelId.length > 0,
    queryFn: async (): Promise<ChannelLoop[]> => {
      const res = await api.v1.channels[":channelId"].loops.$get({
        param: { channelId },
      })
      if (!res.ok) throw new Error("Failed to fetch channel loops")
      const payload = await res.json()
      return payload.loops
    },
  })

  useEffect(() => {
    if (!socket || !channelId) return
    const handleLoopUpdated: ServerToClientEvents["loop:updated"] = (
      payload
    ) => {
      if (payload.loop.channelId !== channelId) return
      if (!queryClient.getQueryData(["channel-loops", channelId])) {
        void queryClient.invalidateQueries({
          queryKey: ["channel-loops", channelId],
        })
      }
      queryClient.setQueryData(
        ["channel-loops", channelId],
        (existing: ChannelLoop[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((l) => l.id !== payload.loop.id)
          return [payload.loop, ...rest]
        }
      )
    }
    const handleLoopDeleted: ServerToClientEvents["loop:deleted"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      queryClient.setQueryData(
        ["channel-loops", channelId],
        (existing: ChannelLoop[] | undefined) =>
          existing?.filter((l) => l.id !== payload.loopId)
      )
    }
    const refetchOnConnect = () => {
      void queryClient.invalidateQueries({
        queryKey: ["channel-loops", channelId],
      })
    }
    socket.on("connect", refetchOnConnect)
    socket.on("loop:updated", handleLoopUpdated)
    socket.on("loop:deleted", handleLoopDeleted)
    return () => {
      socket.off("connect", refetchOnConnect)
      socket.off("loop:updated", handleLoopUpdated)
      socket.off("loop:deleted", handleLoopDeleted)
    }
  }, [socket, queryClient, channelId])

  return query
}

export function useLoopForCard(
  channelId: string,
  cardMessageId: string
): ChannelLoop | null {
  const { data } = useChannelLoops(channelId)
  return data?.find((l) => l.cardMessageId === cardMessageId) ?? null
}

// Activate a draft in the device timezone — same flow as web's quick Create
// Loop button (there's no tz picker on mobile; web's detail panel has it).
// A 422 requires_confirmation becomes a native Alert that resends with
// confirmHighFrequency.
export function useActivateLoop(loop: ChannelLoop | null) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (opts: { confirm?: boolean }) => {
      if (!loop) throw new Error("Loop not loaded yet")
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const res = await api.v1.loops[":loopId"].activate.$post({
        param: { loopId: loop.id },
        json: {
          timezone,
          ...(opts.confirm ? { confirmHighFrequency: true } : {}),
        },
      })
      if (res.status === 422) {
        const body = await res.json()
        return {
          kind: "needs_confirmation" as const,
          firesPerDay: body.firesPerDay,
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? "Failed to create the loop")
      }
      const body = await res.json()
      return { kind: "activated" as const, loop: body.loop }
    },
    onSuccess: (result) => {
      if (result.kind === "needs_confirmation") {
        Alert.alert(
          "Frequent schedule",
          `This loop runs up to ${result.firesPerDay} times a day. Each run uses Merlin credits. Create it anyway?`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Create Loop",
              onPress: () => mutation.mutate({ confirm: true }),
            },
          ]
        )
        return
      }
      // loop:updated also lands via the socket; setting directly makes the
      // flip immediate even on a slow connection.
      queryClient.setQueryData(
        ["channel-loops", result.loop.channelId],
        (existing: ChannelLoop[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((l) => l.id !== result.loop.id)
          return [result.loop, ...rest]
        }
      )
    },
    onError: (err) => {
      Alert.alert(
        "Couldn't create the loop",
        err instanceof Error ? err.message : "Please try again in a moment."
      )
    },
  })
  return mutation
}
