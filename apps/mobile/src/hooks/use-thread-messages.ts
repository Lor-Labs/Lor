import type {
  RealtimeMessage,
  RealtimeMessageThreadUpdated,
  ServerToClientEvents,
} from "@repo/realtime-types"
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
  rollbackOptimisticReply,
} from "@/lib/messages"
import type { AppSocket } from "@/lib/socket"

type CurrentUser = {
  id: string
  name: string
  username?: string | null
  displayUsername?: string | null
  image?: string | null
}

export function useThreadMessages({
  workspaceSlug,
  channelId,
  threadRootId,
  socket,
  currentUser,
}: {
  workspaceSlug: string
  channelId: string
  threadRootId: string
  socket: AppSocket | null
  currentUser?: CurrentUser
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [root, setRoot] = useState<Message | null>(null)
  const [totalReplyCount, setTotalReplyCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [reachedOldest, setReachedOldest] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationError, setPaginationError] = useState<string | null>(null)
  const [isMissing, setIsMissing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const messagesRef = useRef<Message[]>([])
  const beforeCursorRef = useRef<string | null>(null)
  const loadingOlderRef = useRef(false)
  const sendingRef = useRef(false)
  const requestRef = useRef(0)
  const olderRequestRef = useRef(0)
  const identityRef = useRef("")
  const identity = `${workspaceSlug}:${channelId}:${threadRootId}`

  identityRef.current = identity

  const updateMessages = useCallback(
    (updater: (current: Message[]) => Message[]) => {
      const next = updater(messagesRef.current)
      messagesRef.current = next
      setMessages(next)
    },
    []
  )

  const updateRoot = useCallback(
    (updater: (current: Message | null) => Message | null) => {
      setRoot((current) => {
        const next = updater(current)
        return next
      })
    },
    []
  )

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current
    const requestIdentity = `${workspaceSlug}:${channelId}:${threadRootId}`

    if (!workspaceSlug || !channelId || !threadRootId) {
      if (
        requestId === requestRef.current &&
        requestIdentity === identityRef.current
      ) {
        messagesRef.current = []
        beforeCursorRef.current = null
        setMessages([])
        setRoot(null)
        setTotalReplyCount(0)
        setError(null)
        setIsMissing(true)
        setIsLoading(false)
      }
      return
    }

    setIsLoading(true)
    setError(null)
    setPaginationError(null)
    setIsMissing(false)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].messages[":messageId"].thread.$get({
        param: { workspaceSlug, channelId, messageId: threadRootId },
        query: { limit: "50" },
      })
      if (response.status === 404) {
        if (
          requestId === requestRef.current &&
          requestIdentity === identityRef.current
        ) {
          updateRoot(() => null)
          setIsMissing(true)
        }
        return
      }
      if (!response.ok) throw new Error("Could not load this thread")

      const payload = await response.json()
      if (
        requestId === requestRef.current &&
        requestIdentity === identityRef.current
      ) {
        updateMessages((current) => mergeMessages(payload.data, current))
        if (payload.root) updateRoot(() => payload.root)
        beforeCursorRef.current = payload.beforeCursor
        setReachedOldest(payload.reachedOldest)
        setTotalReplyCount(
          payload.root?.threadSummary?.replyCount ?? payload.data.length
        )
        setIsMissing(!payload.root)
      }
    } catch (cause) {
      if (
        requestId === requestRef.current &&
        requestIdentity === identityRef.current
      ) {
        setError(
          cause instanceof Error ? cause.message : "Could not load this thread"
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
  }, [workspaceSlug, channelId, threadRootId, updateMessages, updateRoot])

  useEffect(() => {
    messagesRef.current = []
    beforeCursorRef.current = null
    setMessages([])
    setRoot(null)
    setTotalReplyCount(0)
    setIsLoadingOlder(false)
    setReachedOldest(true)
    setPaginationError(null)
    setIsMissing(false)
    loadingOlderRef.current = false
    void reload()
  }, [reload])

  const loadOlder = useCallback(async () => {
    const before = beforeCursorRef.current
    if (!before || reachedOldest || loadingOlderRef.current) return

    const requestId = ++olderRequestRef.current
    const requestIdentity = `${workspaceSlug}:${channelId}:${threadRootId}`
    loadingOlderRef.current = true
    setIsLoadingOlder(true)
    setPaginationError(null)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].messages[":messageId"].thread.$get({
        param: { workspaceSlug, channelId, messageId: threadRootId },
        query: { before, limit: "50" },
      })
      if (response.status === 404) {
        if (
          requestId === olderRequestRef.current &&
          requestIdentity === identityRef.current
        ) {
          setIsMissing(true)
        }
        return
      }
      if (!response.ok) throw new Error("Could not load older replies")

      const payload = await response.json()
      if (
        requestId === olderRequestRef.current &&
        requestIdentity === identityRef.current
      ) {
        updateMessages((current) => mergeMessages(current, payload.data))
        beforeCursorRef.current = payload.beforeCursor
        setReachedOldest(payload.reachedOldest)
      }
    } catch (cause) {
      if (
        requestId === olderRequestRef.current &&
        requestIdentity === identityRef.current
      ) {
        setPaginationError(
          cause instanceof Error
            ? cause.message
            : "Could not load older replies"
        )
      }
    } finally {
      if (
        requestId === olderRequestRef.current &&
        requestIdentity === identityRef.current
      ) {
        loadingOlderRef.current = false
        setIsLoadingOlder(false)
      }
    }
  }, [workspaceSlug, channelId, threadRootId, reachedOldest, updateMessages])

  useEffect(() => {
    if (!socket || !threadRootId) return

    const joinThread = () => {
      socket.emit("thread:join", { threadRootId })
    }
    const rejoinThread = () => {
      joinThread()
      void reload()
    }
    const receiveMessage = (message: RealtimeMessage) => {
      if (
        message.channelId !== channelId ||
        message.threadRootId !== threadRootId
      ) {
        return
      }
      const alreadyExists = messagesRef.current.some(
        (current) =>
          current.id === message.id ||
          (message.nonce !== undefined && current.id === message.nonce)
      )
      const received = realtimeMessageToMessage(message)
      updateMessages((current) => {
        const withoutOptimistic = message.nonce
          ? removeMessage(current, message.nonce)
          : current
        return mergeMessages([received], withoutOptimistic)
      })
      if (!alreadyExists) setTotalReplyCount((current) => current + 1)
    }
    const updateMessage: ServerToClientEvents["message:updated"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      if (payload.messageId === threadRootId) {
        updateRoot((current) =>
          current
            ? {
                ...current,
                content: payload.content,
                editedAt: payload.editedAt,
              }
            : current
        )
        return
      }
      if (!messagesRef.current.some((item) => item.id === payload.messageId)) {
        return
      }
      updateMessages((current) =>
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
      if (payload.messageId === threadRootId) {
        updateRoot(() => null)
        setIsMissing(true)
        return
      }
      const existed = messagesRef.current.some(
        (message) => message.id === payload.messageId
      )
      if (existed) {
        updateMessages((current) => removeMessage(current, payload.messageId))
        setTotalReplyCount((current) => Math.max(0, current - 1))
      } else {
        void reload()
      }
    }
    const streamMessage: ServerToClientEvents["message:stream"] = (payload) => {
      if (
        payload.channelId !== channelId ||
        payload.threadRootId !== threadRootId
      ) {
        return
      }
      updateMessages((current) =>
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
    const updateThread = (payload: RealtimeMessageThreadUpdated) => {
      if (
        payload.channelId !== channelId ||
        payload.threadRootId !== threadRootId
      ) {
        return
      }
      setTotalReplyCount(payload.replyCount)
      updateRoot((current) =>
        current
          ? (applyThreadSummaryUpdate([current], payload)[0] ?? current)
          : current
      )
    }

    if (socket.connected) joinThread()
    socket.on("connect", rejoinThread)
    socket.on("message:created", receiveMessage)
    socket.on("message:updated", updateMessage)
    socket.on("message:deleted", deleteMessage)
    socket.on("message:stream", streamMessage)
    socket.on("message:thread:updated", updateThread)

    return () => {
      if (socket.connected) socket.emit("thread:leave", { threadRootId })
      socket.off("connect", rejoinThread)
      socket.off("message:created", receiveMessage)
      socket.off("message:updated", updateMessage)
      socket.off("message:deleted", deleteMessage)
      socket.off("message:stream", streamMessage)
      socket.off("message:thread:updated", updateThread)
    }
  }, [socket, channelId, threadRootId, reload, updateMessages, updateRoot])

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed || sendingRef.current) return
      if (!socket?.connected) {
        const errorMessage = "You're offline. Reconnect and try again."
        throw new Error(errorMessage)
      }
      if (!currentUser) {
        const errorMessage =
          "Your session is unavailable. Please sign in again."
        throw new Error(errorMessage)
      }

      const nonce = `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const optimistic = createOptimisticMessage({
        nonce,
        channelId,
        content: trimmed,
        author: currentUser,
        threadRootId,
      })
      sendingRef.current = true
      updateMessages((current) => mergeMessages([optimistic], current))
      setTotalReplyCount((current) => current + 1)
      setIsSending(true)

      try {
        const result = await socket
          .timeout(12_000)
          .emitWithAck("message:send", {
            channelId,
            content: trimmed,
            nonce,
            threadRootId,
          })
        if (!result.ok) throw new Error(result.error)

        const confirmed = realtimeMessageToMessage(result.message)
        updateMessages((current) => replaceMessage(current, nonce, confirmed))
      } catch (cause) {
        updateMessages(
          (current) => rollbackOptimisticReply(current, nonce, 1).messages
        )
        setTotalReplyCount(
          (current) =>
            rollbackOptimisticReply([], nonce, current).totalReplyCount
        )
        const errorMessage =
          cause instanceof Error && cause.message === "operation has timed out"
            ? "Message delivery timed out. Please try again."
            : cause instanceof Error
              ? cause.message
              : "Could not deliver reply. Please try again."
        throw new Error(errorMessage)
      } finally {
        sendingRef.current = false
        setIsSending(false)
      }
    },
    [socket, currentUser, channelId, threadRootId, updateMessages]
  )

  return {
    messages,
    root,
    totalReplyCount,
    isLoading,
    isLoadingOlder,
    hasOlder: !reachedOldest,
    error,
    paginationError,
    isMissing,
    isSending,
    reload,
    loadOlder,
    sendMessage,
  }
}
