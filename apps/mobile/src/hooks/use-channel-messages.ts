import type {
  RealtimeMessageThreadUpdated,
  ServerToClientEvents,
} from "@repo/realtime-types"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { Message } from "@/lib/api-types"
import { appendMerlinReasoning, upsertMerlinToolCall } from "@/lib/merlin"
import {
  applyReactionUpdate,
  applyThreadSummaryUpdate,
  createOptimisticMessage,
  isOptimisticMessage,
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
  const sendingRef = useRef(false)
  const messagesRef = useRef<Message[]>([])
  const reloadRequestRef = useRef(0)
  const channelIdentityRef = useRef("")
  const channelIdentity = `${workspaceSlug}:${channelId}`

  channelIdentityRef.current = channelIdentity

  // `replace` drops local state in favor of the fetched page — used on socket
  // reconnect so deletions missed while offline don't linger.
  const reload = useCallback(
    async ({ replace = false } = {}) => {
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
          // Replace still keeps unacked optimistic sends so an in-flight
          // message survives a reconnect reload until its ack resolves.
          setMessages((current) =>
            mergeMessages(
              payload.data,
              replace ? current.filter(isOptimisticMessage) : current
            )
          )
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
    },
    [workspaceSlug, channelId]
  )

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

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
      void reload({ replace: true })
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
    const updateMessage: ServerToClientEvents["message:updated"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? {
                ...message,
                content: payload.content,
                editedAt: payload.editedAt,
              }
            : message
        )
      )
    }
    const deleteMessage: ServerToClientEvents["message:deleted"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      setMessages((current) => removeMessage(current, payload.messageId))
    }
    const streamMessage: ServerToClientEvents["message:stream"] = (payload) => {
      if (payload.channelId !== channelId || payload.threadRootId) return
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? {
                ...message,
                content: payload.replace
                  ? payload.delta
                  : `${message.content ?? ""}${payload.delta}`,
                mentions: payload.mentions ?? message.mentions,
                status: payload.done
                  ? (payload.status ?? "complete")
                  : "pending",
              }
            : message
        )
      )
    }
    const updateReasoning: ServerToClientEvents["merlin:reasoning"] = (
      payload
    ) => {
      if (payload.channelId !== channelId || payload.threadRootId) return
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? appendMerlinReasoning(message, payload)
            : message
        )
      )
    }
    const updateTool: ServerToClientEvents["merlin:tool"] = (payload) => {
      if (payload.channelId !== channelId || payload.threadRootId) return
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? upsertMerlinToolCall(message, payload.toolCall)
            : message
        )
      )
    }
    const updateMemory: ServerToClientEvents["merlin:memory"] = (payload) => {
      if (payload.channelId !== channelId || payload.threadRootId) return
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? {
                ...message,
                remembered: [
                  ...(message.remembered ?? []).filter(
                    (memory) => memory.path !== payload.path
                  ),
                  { path: payload.path, action: payload.action },
                ],
              }
            : message
        )
      )
    }
    const updateEmbeds: ServerToClientEvents["message:embeds:updated"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? { ...message, embeds: payload.embeds }
            : message
        )
      )
    }
    const updateReaction: ServerToClientEvents["message:reaction:updated"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      setMessages((current) =>
        current.map((message) =>
          applyReactionUpdate(message, payload, currentUser?.id)
        )
      )
    }
    const updatePin: ServerToClientEvents["message:pin:toggled"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? { ...message, pinned: payload.pinned }
            : message
        )
      )
    }

    if (socket.connected) joinChannel()
    socket.on("connect", rejoinChannel)
    socket.on("message:created", receiveMessage)
    socket.on("message:updated", updateMessage)
    socket.on("message:deleted", deleteMessage)
    socket.on("message:stream", streamMessage)
    socket.on("merlin:reasoning", updateReasoning)
    socket.on("merlin:tool", updateTool)
    socket.on("merlin:memory", updateMemory)
    socket.on("message:embeds:updated", updateEmbeds)
    socket.on("message:reaction:updated", updateReaction)
    socket.on("message:pin:toggled", updatePin)
    socket.on("message:thread:updated", updateThreadSummary)

    return () => {
      if (socket.connected) socket.emit("channel:leave", { channelId })
      socket.off("connect", rejoinChannel)
      socket.off("message:created", receiveMessage)
      socket.off("message:updated", updateMessage)
      socket.off("message:deleted", deleteMessage)
      socket.off("message:stream", streamMessage)
      socket.off("merlin:reasoning", updateReasoning)
      socket.off("merlin:tool", updateTool)
      socket.off("merlin:memory", updateMemory)
      socket.off("message:embeds:updated", updateEmbeds)
      socket.off("message:reaction:updated", updateReaction)
      socket.off("message:pin:toggled", updatePin)
      socket.off("message:thread:updated", updateThreadSummary)
    }
  }, [socket, channelId, reload, currentUser?.id])

  const loadAround = useCallback(
    async (messageId: string) => {
      if (messagesRef.current.some((message) => message.id === messageId)) {
        return true
      }
      const requestIdentity = `${workspaceSlug}:${channelId}`
      try {
        const response = await api.v1.workspaces[":workspaceSlug"].channels[
          ":channelId"
        ].messages.$get({
          param: { workspaceSlug, channelId },
          query: { around: messageId, limit: "50" },
        })
        if (!response.ok) return false
        const payload = await response.json()
        if (requestIdentity !== channelIdentityRef.current) return false
        setMessages((current) => mergeMessages(current, payload.data))
        return payload.data.some((message) => message.id === messageId)
      } catch {
        return false
      }
    },
    [workspaceSlug, channelId]
  )

  const sendMessage = useCallback(
    async (content: string, referencedMessage?: Message) => {
      const trimmed = content.trim()
      if (!trimmed || sendingRef.current) return
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
        referencedMessage: referencedMessage
          ? {
              id: referencedMessage.id,
              content: referencedMessage.content,
              author: referencedMessage.author,
              overrideName: referencedMessage.overrideName,
              overrideAvatarUrl: referencedMessage.overrideAvatarUrl,
            }
          : null,
      })
      sendingRef.current = true
      setMessages((current) => mergeMessages([optimistic], current))
      setIsSending(true)
      setError(null)

      try {
        const result = await socket
          .timeout(12_000)
          .emitWithAck("message:send", {
            channelId,
            content: trimmed,
            nonce,
            referencedMessageId: referencedMessage?.id,
          })

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
        sendingRef.current = false
        setIsSending(false)
      }
    },
    [socket, currentUser, channelId]
  )

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!socket?.connected) return
      socket.emit(
        "message:reaction:toggle",
        { channelId, messageId, emoji },
        (result) => {
          if (!result.ok) return
          setMessages((current) =>
            current.map((message) =>
              applyReactionUpdate(message, result.update, currentUser?.id)
            )
          )
        }
      )
    },
    [socket, channelId, currentUser?.id]
  )

  const togglePin = useCallback(
    async (messageId: string, currentlyPinned: boolean) => {
      const nextPinned = !currentlyPinned
      const updatePin = (pinned: boolean, onlyIf?: boolean) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId &&
            (onlyIf === undefined || message.pinned === onlyIf)
              ? { ...message, pinned }
              : message
          )
        )
      }

      updatePin(nextPinned)
      try {
        const response = await api.v1.workspaces[":workspaceSlug"].channels[
          ":channelId"
        ].messages[":messageId"].pin.$patch({
          param: { workspaceSlug, channelId, messageId },
        })
        if (!response.ok) throw new Error("Could not update message pin")
        const result = await response.json()
        updatePin(result.pinned)
      } catch {
        updatePin(currentlyPinned, nextPinned)
        return false
      }
      return true
    },
    [workspaceSlug, channelId]
  )

  return {
    messages,
    isLoading,
    error,
    isSending,
    reload,
    loadAround,
    sendMessage,
    toggleReaction,
    togglePin,
  }
}
