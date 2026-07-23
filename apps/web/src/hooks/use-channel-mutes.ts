import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export type ChannelMute = { channelId: string; mutedUntil: string | null }

export const MUTE_DURATIONS = [
  { label: "For 15 minutes", minutes: 15 },
  { label: "For 1 hour", minutes: 60 },
  { label: "For 8 hours", minutes: 480 },
  { label: "For 24 hours", minutes: 1440 },
  { label: "Until I turn it back on", minutes: null },
] as const

export const channelMutesQueryOptions = {
  queryKey: ["channel-mutes"] as const,
  queryFn: async (): Promise<ChannelMute[]> => {
    const res = await apiClient.v1["channel-mutes"].$get()
    if (!res.ok) throw new Error("Failed to fetch channel mutes")
    const payload = await res.json()
    return payload.mutes
  },
}

export function findActiveMute(
  mutes: ChannelMute[] | undefined,
  channelId: string
) {
  const mute = mutes?.find((item) => item.channelId === channelId)
  if (!mute) return null
  if (mute.mutedUntil && new Date(mute.mutedUntil).getTime() <= Date.now()) {
    return null
  }
  return mute
}

export function useChannelMutes() {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data: mutes } = useQuery(channelMutesQueryOptions)

  useEffect(() => {
    if (!socket) return
    const onUpdated = () => {
      void queryClient.invalidateQueries({ queryKey: ["channel-mutes"] })
    }
    socket.on("channel-mute:updated", onUpdated)
    return () => {
      socket.off("channel-mute:updated", onUpdated)
    }
  }, [socket, queryClient])

  const getMute = useCallback(
    (channelId: string) => findActiveMute(mutes, channelId),
    [mutes]
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["channel-mutes"] })
  }

  const applyOptimistic = (
    update: (old: ChannelMute[]) => ChannelMute[]
  ): { previous: ChannelMute[] | undefined } => {
    const previous = queryClient.getQueryData<ChannelMute[]>(["channel-mutes"])
    queryClient.setQueryData<ChannelMute[]>(["channel-mutes"], (old) =>
      update(old ?? [])
    )
    return { previous }
  }

  const muteMutation = useMutation({
    mutationFn: async ({
      channelId,
      until,
    }: {
      channelId: string
      until: string | null
    }) => {
      const res = await apiClient.v1["channel-mutes"][":channelId"].$put({
        param: { channelId },
        json: { until },
      })
      if (!res.ok) throw new Error("Could not mute this channel")
    },
    onMutate: ({ channelId, until }) =>
      applyOptimistic((old) => [
        ...old.filter((item) => item.channelId !== channelId),
        { channelId, mutedUntil: until },
      ]),
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(["channel-mutes"], context.previous)
      }
    },
    onSettled: invalidate,
  })

  const unmuteMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const res = await apiClient.v1["channel-mutes"][":channelId"].$delete({
        param: { channelId },
      })
      if (!res.ok) throw new Error("Could not unmute this channel")
    },
    onMutate: (channelId) =>
      applyOptimistic((old) =>
        old.filter((item) => item.channelId !== channelId)
      ),
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(["channel-mutes"], context.previous)
      }
    },
    onSettled: invalidate,
  })

  const muteChannel = useCallback(
    ({ channelId, minutes }: { channelId: string; minutes: number | null }) => {
      const until = minutes
        ? new Date(Date.now() + minutes * 60_000).toISOString()
        : null
      muteMutation.mutate({ channelId, until })
    },
    [muteMutation.mutate]
  )

  return {
    getMute,
    muteChannel,
    unmuteChannel: unmuteMutation.mutate,
  }
}
