import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect } from "react"
import { Alert } from "react-native"
import { useSocket } from "@/context/socket-context"
import { api, responseMessage } from "@/lib/api"

export type ChannelMute = { channelId: string; mutedUntil: string | null }

export const MUTE_DURATIONS = [
  { label: "For 15 minutes", minutes: 15 },
  { label: "For 1 hour", minutes: 60 },
  { label: "For 8 hours", minutes: 480 },
  { label: "For 24 hours", minutes: 1440 },
  { label: "Until I turn it back on", minutes: null },
] as const

export function mutedUntilLabel(mutedUntil: string | null) {
  if (!mutedUntil) return "Muted until you turn it back on"
  const until = new Date(mutedUntil)
  return `Muted until ${until.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`
}

export function promptChannelMute(options: {
  channelId: string
  channelLabel: string
  mute: ChannelMute | null
  muteChannel: (channelId: string, minutes: number | null) => Promise<void>
  unmuteChannel: (channelId: string) => Promise<void>
}) {
  const showError = (cause: unknown) => {
    Alert.alert(
      "Something went wrong",
      cause instanceof Error ? cause.message : "Please try again in a moment."
    )
  }

  if (options.mute) {
    Alert.alert(
      `Unmute ${options.channelLabel}?`,
      mutedUntilLabel(options.mute.mutedUntil),
      [
        { style: "cancel", text: "Cancel" },
        {
          text: "Unmute",
          onPress: () =>
            void options.unmuteChannel(options.channelId).catch(showError),
        },
      ]
    )
    return
  }
  Alert.alert(
    `Mute ${options.channelLabel}`,
    "You won't get notifications from this channel while it's muted, on any device. Unread badges are unaffected.",
    [
      ...MUTE_DURATIONS.map((duration) => ({
        text: duration.label,
        onPress: () =>
          void options
            .muteChannel(options.channelId, duration.minutes)
            .catch(showError),
      })),
      { style: "cancel" as const, text: "Cancel" },
    ]
  )
}

export function useChannelMutes() {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data: mutes } = useQuery({
    queryKey: ["channel-mutes"],
    queryFn: async (): Promise<ChannelMute[]> => {
      const response = await api.v1["channel-mutes"].$get()
      if (!response.ok) throw new Error("Could not load channel mutes")
      const payload = await response.json()
      return payload.mutes
    },
  })

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

  // Timed mutes expire without any event — refetch at the nearest expiry so
  // open sheets flip back on their own (mirrors the web hook).
  useEffect(() => {
    if (!mutes) return
    const now = Date.now()
    const expiries = mutes
      .map((mute) =>
        mute.mutedUntil ? new Date(mute.mutedUntil).getTime() : null
      )
      .filter((time): time is number => time !== null && time > now)
    if (expiries.length === 0) return
    const delay = Math.min(...expiries) - now + 1_000
    if (delay > 2 ** 31 - 1) return
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ["channel-mutes"] })
    }, delay)
    return () => clearTimeout(timer)
  }, [mutes, queryClient])

  const getMute = useCallback(
    (channelId: string) => {
      const mute = mutes?.find((item) => item.channelId === channelId)
      if (!mute) return null
      if (
        mute.mutedUntil &&
        new Date(mute.mutedUntil).getTime() <= Date.now()
      ) {
        return null
      }
      return mute
    },
    [mutes]
  )

  const muteChannel = useCallback(
    async (channelId: string, minutes: number | null) => {
      const until = minutes
        ? new Date(Date.now() + minutes * 60_000).toISOString()
        : null
      await queryClient.cancelQueries({ queryKey: ["channel-mutes"] })
      const previous = queryClient.getQueryData<ChannelMute[]>([
        "channel-mutes",
      ])
      queryClient.setQueryData<ChannelMute[]>(["channel-mutes"], (old) => [
        ...(old ?? []).filter((item) => item.channelId !== channelId),
        { channelId, mutedUntil: until },
      ])
      try {
        const response = await api.v1["channel-mutes"][":channelId"].$put({
          param: { channelId },
          json: { until },
        })
        if (!response.ok) {
          throw new Error(
            await responseMessage(response, "Could not mute this channel")
          )
        }
      } catch (cause) {
        queryClient.setQueryData(["channel-mutes"], previous ?? [])
        throw cause
      } finally {
        void queryClient.invalidateQueries({ queryKey: ["channel-mutes"] })
      }
    },
    [queryClient]
  )

  const unmuteChannel = useCallback(
    async (channelId: string) => {
      await queryClient.cancelQueries({ queryKey: ["channel-mutes"] })
      const previous = queryClient.getQueryData<ChannelMute[]>([
        "channel-mutes",
      ])
      queryClient.setQueryData<ChannelMute[]>(["channel-mutes"], (old) =>
        (old ?? []).filter((item) => item.channelId !== channelId)
      )
      try {
        const response = await api.v1["channel-mutes"][":channelId"].$delete({
          param: { channelId },
        })
        if (!response.ok) {
          throw new Error(
            await responseMessage(response, "Could not unmute this channel")
          )
        }
      } catch (cause) {
        queryClient.setQueryData(["channel-mutes"], previous ?? [])
        throw cause
      } finally {
        void queryClient.invalidateQueries({ queryKey: ["channel-mutes"] })
      }
    },
    [queryClient]
  )

  return { getMute, muteChannel, unmuteChannel }
}
