import type {
  RealtimeMessage,
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

  const loadAround = useCallback(
    async (messageId: string) => {
      if (
        root?.id === messageId ||
        messagesRef.current.some((message) => message.id === messageId)
      ) {
        return true
      }
      const requestIdentity = `${workspaceSlug}:${channelId}:${threadRootId}`
      try {
        const response = await api.v1.workspaces[":workspaceSlug"].channels[
          ":channelId"
        ].messages[":messageId"].thread.$get({
          param: { workspaceSlug, channelId, messageId: threadRootId },
          query: { around: messageId, limit: "50" },
        })
        if (!response.ok) return false
        const payload = await response.json()
        if (requestIdentity !== identityRef.current) return false
        updateMessages((current) => mergeMessages(current, payload.data))
        if (payload.root) updateRoot(() => payload.root)
        return (
          payload.root?.id === messageId ||
          payload.data.some((message) => message.id === messageId)
        )
      } catch {
        return false
      }
    },
    [workspaceSlug, channelId, threadRootId, root, updateMessages, updateRoot]
  )

  useEffect(() => {
    if (!socket || !threadRootId) return

    const joinThread = () => {
      socket.emit("thread:join", { threadRootId })
      socket.emit("channel:join", { channelId })
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
      if (payload.channelId !== channelId) return
      if (payload.messageId === threadRootId) {
        updateRoot((current) =>
          current
            ? {
                ...current,
                content: payload.replace
                  ? payload.delta
                  : `${current.content ?? ""}${payload.delta}`,
                mentions: payload.mentions ?? current.mentions,
                status: payload.done
                  ? (payload.status ?? "complete")
                  : "pending",
              }
            : current
        )
        return
      }
      if (payload.threadRootId !== threadRootId) return
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
    const updateReasoning: ServerToClientEvents["merlin:reasoning"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      if (payload.messageId === threadRootId) {
        updateRoot((current) =>
          current ? appendMerlinReasoning(current, payload) : current
        )
        return
      }
      if (payload.threadRootId !== threadRootId) return
      updateMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? appendMerlinReasoning(message, payload)
            : message
        )
      )
    }
    const updateTool: ServerToClientEvents["merlin:tool"] = (payload) => {
      if (payload.channelId !== channelId) return
      if (payload.messageId === threadRootId) {
        updateRoot((current) =>
          current ? upsertMerlinToolCall(current, payload.toolCall) : current
        )
        return
      }
      if (payload.threadRootId !== threadRootId) return
      updateMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? upsertMerlinToolCall(message, payload.toolCall)
            : message
        )
      )
    }
    const updateMemory: ServerToClientEvents["merlin:memory"] = (payload) => {
      if (payload.channelId !== channelId) return
      if (payload.messageId === threadRootId) {
        updateRoot((current) =>
          current
            ? {
                ...current,
                remembered: [
                  ...(current.remembered ?? []).filter(
                    (memory) => memory.path !== payload.path
                  ),
                  { path: payload.path, action: payload.action },
                ],
              }
            : current
        )
        return
      }
      if (payload.threadRootId !== threadRootId) return
      updateMessages((current) =>
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
      updateMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? { ...message, embeds: payload.embeds }
            : message
        )
      )
      updateRoot((current) =>
        current?.id === payload.messageId
          ? { ...current, embeds: payload.embeds }
          : current
      )
    }
    const updateReaction: ServerToClientEvents["message:reaction:updated"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      updateMessages((current) =>
        current.map((message) =>
          applyReactionUpdate(message, payload, currentUser?.id)
        )
      )
      updateRoot((current) =>
        current
          ? applyReactionUpdate(current, payload, currentUser?.id)
          : current
      )
    }
    const updatePin: ServerToClientEvents["message:pin:toggled"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      updateMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? { ...message, pinned: payload.pinned }
            : message
        )
      )
      updateRoot((current) =>
        current?.id === payload.messageId
          ? { ...current, pinned: payload.pinned }
          : current
      )
    }

    if (socket.connected) joinThread()
    socket.on("connect", rejoinThread)
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
    socket.on("message:thread:updated", updateThread)

    return () => {
      if (socket.connected) socket.emit("thread:leave", { threadRootId })
      if (socket.connected) socket.emit("channel:leave", { channelId })
      socket.off("connect", rejoinThread)
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
      socket.off("message:thread:updated", updateThread)
    }
  }, [
    socket,
    channelId,
    threadRootId,
    reload,
    updateMessages,
    updateRoot,
    currentUser?.id,
  ])

  const sendMessage = useCallback(
    async (content: string, referencedMessage?: Message) => {
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
        referencedMessage: referencedMessage
          ? {
              id: referencedMessage.id,
              content: referencedMessage.content,
              author: referencedMessage.author,
            }
          : null,
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
            referencedMessageId: referencedMessage?.id,
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

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!socket?.connected) return
      socket.emit(
        "message:reaction:toggle",
        { channelId, messageId, emoji },
        (result) => {
          if (!result.ok) return
          updateMessages((current) =>
            current.map((message) =>
              applyReactionUpdate(message, result.update, currentUser?.id)
            )
          )
          updateRoot((current) =>
            current
              ? applyReactionUpdate(current, result.update, currentUser?.id)
              : current
          )
        }
      )
    },
    [socket, channelId, currentUser?.id, updateMessages, updateRoot]
  )

  const togglePin = useCallback(
    async (messageId: string, currentlyPinned: boolean) => {
      const nextPinned = !currentlyPinned
      const updatePin = (pinned: boolean, onlyIf?: boolean) => {
        updateMessages((current) =>
          current.map((message) =>
            message.id === messageId &&
            (onlyIf === undefined || message.pinned === onlyIf)
              ? { ...message, pinned }
              : message
          )
        )
        updateRoot((current) =>
          current?.id === messageId &&
          (onlyIf === undefined || current.pinned === onlyIf)
            ? { ...current, pinned }
            : current
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
    [workspaceSlug, channelId, updateMessages, updateRoot]
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
    loadAround,
    sendMessage,
    toggleReaction,
    togglePin,
  }
}
