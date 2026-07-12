import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"
import type { Message } from "@/lib/api-types"
import {
  createOptimisticMessage,
  realtimeMessageToMessage,
} from "@/lib/messages"
import type { AppSocket } from "@/lib/socket"

function mergeMessages(...groups: Message[][]) {
  const byId = new Map<string, Message>()
  for (const group of groups) {
    for (const message of group) byId.set(message.id, message)
  }
  return [...byId.values()].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  )
}

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

  const reload = useCallback(async () => {
    if (!workspaceSlug || !channelId) {
      setIsLoading(false)
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
      setMessages((current) => mergeMessages(payload.data, current))
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load messages"
      )
    } finally {
      setIsLoading(false)
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
    const receiveMessage = (
      message: Parameters<typeof realtimeMessageToMessage>[0]
    ) => {
      if (message.channelId !== channelId || message.threadRootId) return
      const next = realtimeMessageToMessage(message)
      setMessages((current) => mergeMessages([next], current))
    }

    if (socket.connected) joinChannel()
    socket.on("connect", joinChannel)
    socket.on("message:created", receiveMessage)

    return () => {
      if (socket.connected) socket.emit("channel:leave", { channelId })
      socket.off("connect", joinChannel)
      socket.off("message:created", receiveMessage)
    }
  }, [socket, channelId])

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed || !socket?.connected || !currentUser || isSending) return

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

      await new Promise<void>((resolve) => {
        let settled = false
        const settle = () => {
          if (settled) return
          settled = true
          resolve()
        }
        const timeout = setTimeout(() => {
          setMessages((current) =>
            current.filter((message) => message.id !== nonce)
          )
          setError("Message delivery timed out. Please try again.")
          settle()
        }, 12_000)

        socket.emit(
          "message:send",
          { channelId, content: trimmed, nonce },
          (result) => {
            clearTimeout(timeout)
            if (result.ok) {
              const confirmed = realtimeMessageToMessage(result.message)
              setMessages((current) =>
                mergeMessages(
                  [confirmed],
                  current.filter((message) => message.id !== nonce)
                )
              )
            } else {
              setMessages((current) =>
                current.filter((message) => message.id !== nonce)
              )
              setError(result.error)
            }
            settle()
          }
        )
      })
      setIsSending(false)
    },
    [socket, currentUser, isSending, channelId]
  )

  return { messages, isLoading, error, isSending, reload, sendMessage }
}
