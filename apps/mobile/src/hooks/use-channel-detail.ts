import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { ChannelDetail } from "@/lib/api-types"

export function useChannelDetail({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const [channel, setChannel] = useState<ChannelDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const identityRef = useRef("")
  const identity = `${workspaceSlug}:${channelId}`

  identityRef.current = identity

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current
    const requestIdentity = `${workspaceSlug}:${channelId}`

    if (!workspaceSlug || !channelId) {
      if (
        requestId === requestRef.current &&
        requestIdentity === identityRef.current
      ) {
        setChannel(null)
        setError(null)
        setIsLoading(false)
      }
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$get({
        param: { workspaceSlug, channelId },
      })
      if (!response.ok) throw new Error("Could not load this channel")
      const payload = await response.json()
      if (
        requestId === requestRef.current &&
        requestIdentity === identityRef.current
      ) {
        setChannel(payload)
      }
    } catch (cause) {
      if (
        requestId === requestRef.current &&
        requestIdentity === identityRef.current
      ) {
        setChannel(null)
        setError(
          cause instanceof Error ? cause.message : "Could not load this channel"
        )
      }
    } finally {
      if (
        requestId === requestRef.current &&
        requestIdentity === identityRef.current
      ) {
        setIsLoading(false)
      }
    }
  }, [workspaceSlug, channelId])

  useEffect(() => {
    setChannel(null)
    void reload()
  }, [reload])

  const replaceChannel = useCallback(
    (nextChannel: ChannelDetail) => {
      if (nextChannel.id !== channelId) return
      requestRef.current += 1
      setChannel(nextChannel)
      setError(null)
      setIsLoading(false)
    },
    [channelId]
  )

  return { channel, isLoading, error, reload, replaceChannel }
}
