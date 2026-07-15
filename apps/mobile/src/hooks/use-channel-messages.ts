import type { RealtimeMessageThreadUpdated } from "@repo/realtime-types"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { Message } from "@/lib/api-types"
import {
  applyThreadSummaryUpdate,
  createOptimisticMessage,
  mergeMessages,
  realtimeMessageToMessage,
  removeMessage,
  replaceMessage,
} from "@/lib/messages"
import type { AppSocket } from "@/lib/socket"

export function useChannelMessages({
  workspaceSlug,
  channelId,
  socket,
  currentUser,
}: {
  workspaceSlug: string
  channelId: string
  socket: AppSocket | null
  currentUser?: {
    id: string
    name: string
    username?: string | null
    displayUsername?: string | null
    image?: string | null
  }
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const reloadRequestRef = useRef(0)
  const channelIdentityRef = useRef("")
  const channelIdentity = `${workspaceSlug}:${channelId}`

  channelIdentityRef.current = channelIdentity

  const reload = useCallback(async () => {
    const requestId = ++reloadRequestRef.current
    const requestIdentity = `${workspaceSlug}:${channelId}`

    if (!workspaceSlug || !channelId) {
      if (
        requestId === reloadRequestRef.current &&
        requestIdentity === channelIdentityRef.current
      ) {
        setMessages([])
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
      ].messages.$get({
        param: { workspaceSlug, channelId },
        query: { limit: "50" },
      })
      if (!response.ok) throw new Error("Could not load messages")
      const payload = await response.json()
      if (
        requestId === reloadRequestRef.current &&
        requestIdentity === channelIdentityRef.current
      ) {
        setMessages((current) => mergeMessages(payload.data, current))
      }
    } catch (cause) {
      if (
        requestId === reloadRequestRef.current &&
        requestIdentity === channelIdentityRef.current
      ) {
        setError(
          cause instanceof Error ? cause.message : "Could not load messages"
        )
      }
    } finally {
      if (
        requestId === reloadRequestRef.current &&
        requestIdentity === channelIdentityRef.current
      ) {
        setIsLoading(false)
      }
    }
  }, [workspaceSlug, channelId])

  useEffect(() => {
    setMessages([])
    void reload()
  }, [reload])

  useEffect(() => {
    if (!socket) return

    const joinChannel = () => {
      socket.emit("channel:join", { channelId })
    }
    const rejoinChannel = () => {
      joinChannel()
      void reload()
    }
    const receiveMessage = (
      message: Parameters<typeof realtimeMessageToMessage>[0]
    ) => {
      if (message.channelId !== channelId || message.threadRootId) return
      const next = realtimeMessageToMessage(message)
      setMessages((current) => mergeMessages([next], current))
    }
    const updateThreadSummary = (payload: RealtimeMessageThreadUpdated) => {
      if (payload.channelId !== channelId) return
      setMessages((current) => applyThreadSummaryUpdate(current, payload))
    }

    if (socket.connected) joinChannel()
    socket.on("connect", rejoinChannel)
    socket.on("message:created", receiveMessage)
    socket.on("message:thread:updated", updateThreadSummary)

    return () => {
      if (socket.connected) socket.emit("channel:leave", { channelId })
      socket.off("connect", rejoinChannel)
      socket.off("message:created", receiveMessage)
      socket.off("message:thread:updated", updateThreadSummary)
    }
  }, [socket, channelId, reload])

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed || isSending) return
      if (!socket?.connected) {
        const errorMessage = "You're offline. Reconnect and try again."
        setError(errorMessage)
        throw new Error(errorMessage)
      }
      if (!currentUser) {
        const errorMessage =
          "Your session is unavailable. Please sign in again."
        setError(errorMessage)
        throw new Error(errorMessage)
      }

      const nonce = `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const optimistic = createOptimisticMessage({
        nonce,
        channelId,
        content: trimmed,
        author: currentUser,
      })
      setMessages((current) => mergeMessages([optimistic], current))
      setIsSending(true)
      setError(null)

      try {
        const result = await socket
          .timeout(12_000)
          .emitWithAck("message:send", { channelId, content: trimmed, nonce })

        if (!result.ok) throw new Error(result.error)

        const confirmed = realtimeMessageToMessage(result.message)
        setMessages((current) => replaceMessage(current, nonce, confirmed))
      } catch (cause) {
        setMessages((current) => removeMessage(current, nonce))
        const errorMessage =
          cause instanceof Error && cause.message === "operation has timed out"
            ? "Message delivery timed out. Please try again."
            : cause instanceof Error
              ? cause.message
              : "Could not deliver message. Please try again."
        setError(errorMessage)
        throw cause
      } finally {
        setIsSending(false)
      }
    },
    [socket, currentUser, isSending, channelId]
  )

  return { messages, isLoading, error, isSending, reload, sendMessage }
}
