import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { Message } from "@/lib/api-types"

export function usePinnedMessages({
  channelId,
  enabled,
  workspaceSlug,
}: {
  channelId: string
  enabled: boolean
  workspaceSlug: string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const reload = useCallback(async () => {
    if (!workspaceSlug || !channelId) return
    const requestId = ++requestRef.current
    setIsLoading(true)
    setError(null)

    try {
      const response = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].pins.$get({ param: { workspaceSlug, channelId } })
      if (!response.ok) throw new Error("Could not load pinned messages")
      const payload = await response.json()
      if (requestId === requestRef.current) setMessages(payload.data)
    } catch (cause) {
      if (requestId !== requestRef.current) return
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load pinned messages"
      )
    } finally {
      if (requestId === requestRef.current) setIsLoading(false)
    }
  }, [workspaceSlug, channelId])

  useEffect(() => {
    requestRef.current += 1
    setMessages([])
    setError(null)
    setIsLoading(false)
  }, [workspaceSlug, channelId])

  useEffect(() => {
    if (!enabled) {
      requestRef.current += 1
      setIsLoading(false)
      return
    }
    void reload()
  }, [enabled, reload])

  const remove = useCallback((messageId: string) => {
    setMessages((current) =>
      current.filter((message) => message.id !== messageId)
    )
  }, [])

  return { messages, isLoading, error, reload, remove }
}
