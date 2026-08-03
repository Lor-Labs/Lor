import type {
  RealtimeMessageThreadUpdated,
  ServerToClientEvents,
} from "@repo/realtime-types"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { Message } from "@/lib/api-types"
import {
  applyReactionUpdate,
  applyThreadSummaryUpdate,
  createOptimisticMessage,
  isOptimisticMessage,
  mergeMessages,
  realtimeMessageToMessage,
  removeMessage,
  replaceMessage,
  updateMessageContent,
} from "@/lib/messages"
import {
  applyMerlinFrame,
  clearRunReplay,
  gateRunFrame,
  type MerlinFrame,
  startRunReplay,
} from "@/lib/run-replay"
import type { AppSocket } from "@/lib/socket"

export type MessageSource =
  | { kind: "channel"; workspaceSlug: string; channelId: string }
  | { kind: "dm"; dmId: string }

function fetchMessagesPage({
  sourceKind,
  workspaceSlug,
  channelId,
  query,
}: {
  sourceKind: MessageSource["kind"]
  workspaceSlug: string
  channelId: string
  query: { limit: string; around?: string }
}) {
  return sourceKind === "channel"
    ? api.v1.workspaces[":workspaceSlug"].channels[":channelId"].messages.$get({
        param: { workspaceSlug, channelId },
        query,
      })
    : api.v1.dms[":dmId"].messages.$get({
        param: { dmId: channelId },
        query,
      })
}

export function useChannelMessages({
  source,
  socket,
  currentUser,
}: {
  source: MessageSource
  socket: AppSocket | null
  currentUser?: {
    id: string
    name: string
    username?: string | null
    displayUsername?: string | null
    image?: string | null
  }
}) {
  const sourceKind = source.kind
  const workspaceSlug = source.kind === "channel" ? source.workspaceSlug : ""
  const channelId = source.kind === "channel" ? source.channelId : source.dmId
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const sendingRef = useRef(false)
  const messagesRef = useRef<Message[]>([])
  const reloadRequestRef = useRef(0)
  const channelIdentityRef = useRef("")
  const channelIdentity = `${sourceKind}:${workspaceSlug}:${channelId}`

  channelIdentityRef.current = channelIdentity

  // `replace` drops local state in favor of the fetched page — used on socket
  // reconnect so deletions missed while offline don't linger. `silent` skips
  // the loading state so already-rendered messages stay visible. Returns the
  // fetched page (or null on failure) so error paths can check canonical state.
  const reload = useCallback(
    async ({
      replace = false,
      silent = false,
    } = {}): Promise<Message[] | null> => {
      const requestId = ++reloadRequestRef.current
      const requestIdentity = `${sourceKind}:${workspaceSlug}:${channelId}`

      if (!channelId || (sourceKind === "channel" && !workspaceSlug)) {
        if (
          requestId === reloadRequestRef.current &&
          requestIdentity === channelIdentityRef.current
        ) {
          setMessages([])
          setError(null)
          setIsLoading(false)
        }
        return null
      }

      if (!silent) setIsLoading(true)
      setError(null)
      try {
        const response = await fetchMessagesPage({
          sourceKind,
          workspaceSlug,
          channelId,
          query: { limit: "50" },
        })
        if (!response.ok) throw new Error("Could not load messages")
        const payload = await response.json()
        if (
          requestId === reloadRequestRef.current &&
          requestIdentity === channelIdentityRef.current
        ) {
          queryClient.setQueryData(["messages", channelId], payload.data)
          // Replace still keeps unacked optimistic sends so an in-flight
          // message survives a reconnect reload until its ack resolves.
          setMessages((current) =>
            mergeMessages(
              payload.data,
              replace ? current.filter(isOptimisticMessage) : current
            )
          )
          return payload.data
        }
        return null
      } catch (cause) {
        if (
          requestId === reloadRequestRef.current &&
          requestIdentity === channelIdentityRef.current
        ) {
          setError(
            cause instanceof Error ? cause.message : "Could not load messages"
          )
        }
        return null
      } finally {
        if (
          requestId === reloadRequestRef.current &&
          requestIdentity === channelIdentityRef.current
        ) {
          setIsLoading(false)
        }
      }
    },
    [sourceKind, workspaceSlug, channelId, queryClient]
  )

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const applyFrame = useCallback((frame: MerlinFrame) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === frame.payload.messageId
          ? applyMerlinFrame(message, frame)
          : message
      )
    )
  }, [])

  const applyRunPatch = useCallback(
    (messageId: string, patch: Partial<Message>) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, ...patch } : message
        )
      )
    },
    []
  )

  // Late-join trace recovery: replay the durable event log of any pending
  // Merlin placeholder in view (no-ops for already-started replays). Started
  // replays are released on unmount — this hook's message state dies with it,
  // so a remount mid-run must be able to replay again.
  const startedReplays = useRef(new Set<string>())
  useEffect(() => {
    for (const message of messages) {
      if (message.status !== "pending") continue
      startedReplays.current.add(message.id)
      startRunReplay({
        messageId: message.id,
        applyPatch: applyRunPatch,
        applyFrame,
        onTerminal: () => void reload({ silent: true }),
      })
    }
  }, [messages, applyRunPatch, applyFrame, reload])
  useEffect(
    () => () => {
      for (const id of startedReplays.current) clearRunReplay(id)
    },
    []
  )

  // Seed from the last cached page so returning to a channel renders
  // instantly; the silent replace-reload reconciles against the server.
  useEffect(() => {
    const cached = channelId
      ? queryClient.getQueryData<Message[]>(["messages", channelId])
      : undefined
    const seeded = Boolean(cached?.length)
    setMessages(cached ?? [])
    if (seeded) setIsLoading(false)
    void reload({ replace: seeded, silent: seeded })
  }, [reload, channelId, queryClient])

  // Keep the cache current with socket-applied updates for the next visit.
  useEffect(() => {
    if (!channelId) return
    return () => {
      const snapshot = messagesRef.current.filter(
        (message) => !isOptimisticMessage(message)
      )
      if (snapshot.length > 0) {
        queryClient.setQueryData(["messages", channelId], snapshot)
      }
    }
  }, [channelId, queryClient])

  useEffect(() => {
    if (!socket) return

    const joinChannel = () => {
      socket.emit("channel:join", { channelId })
    }
    const rejoinChannel = () => {
      joinChannel()
      void reload({ replace: true, silent: true })
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
        updateMessageContent(
          current,
          payload.messageId,
          payload.content,
          payload.editedAt,
          payload.mentions
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
      const frame: MerlinFrame = { type: "stream", payload }
      if (gateRunFrame(frame)) return
      applyFrame(frame)
    }
    const updateReasoning: ServerToClientEvents["merlin:reasoning"] = (
      payload
    ) => {
      if (payload.channelId !== channelId || payload.threadRootId) return
      const frame: MerlinFrame = { type: "reasoning", payload }
      if (gateRunFrame(frame)) return
      applyFrame(frame)
    }
    const updateTool: ServerToClientEvents["merlin:tool"] = (payload) => {
      if (payload.channelId !== channelId || payload.threadRootId) return
      const frame: MerlinFrame = { type: "tool", payload }
      if (gateRunFrame(frame)) return
      applyFrame(frame)
    }
    const updateMemory: ServerToClientEvents["merlin:memory"] = (payload) => {
      if (payload.channelId !== channelId || payload.threadRootId) return
      const frame: MerlinFrame = { type: "memory", payload }
      if (gateRunFrame(frame)) return
      applyFrame(frame)
    }
    // A mid-run send was absorbed by the active run — chip the sender's
    // message with what happened (steered vs queued).
    const routeMessage: ServerToClientEvents["message:routed"] = (payload) => {
      if (payload.channelId !== channelId || payload.threadRootId) return
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? { ...message, routedOutcome: payload.outcome }
            : message
        )
      )
    }
    // The queue row settled (drained, rejected, or withdrawn) — drop the chip.
    const settleQueued: ServerToClientEvents["run:queue:updated"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? { ...message, routedOutcome: undefined }
            : message
        )
      )
    }
    // A steered message was injected — the placeholder shows who's steering.
    const steerMessage: ServerToClientEvents["merlin:steer"] = (payload) => {
      if (payload.channelId !== channelId) return
      // Chip clear is ungated: chips aren't replayed state.
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.steeredMessageId
            ? { ...message, routedOutcome: undefined }
            : message
        )
      )
      if (payload.threadRootId) return
      const frame: MerlinFrame = { type: "steer", payload }
      if (gateRunFrame(frame)) return
      applyFrame(frame)
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
    socket.on("message:routed", routeMessage)
    socket.on("run:queue:updated", settleQueued)
    socket.on("merlin:steer", steerMessage)
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
      socket.off("message:routed", routeMessage)
      socket.off("run:queue:updated", settleQueued)
      socket.off("merlin:steer", steerMessage)
      socket.off("message:embeds:updated", updateEmbeds)
      socket.off("message:reaction:updated", updateReaction)
      socket.off("message:pin:toggled", updatePin)
      socket.off("message:thread:updated", updateThreadSummary)
    }
  }, [socket, channelId, reload, currentUser?.id, applyFrame])

  const loadAround = useCallback(
    async (messageId: string) => {
      if (messagesRef.current.some((message) => message.id === messageId)) {
        return true
      }
      const requestIdentity = `${sourceKind}:${workspaceSlug}:${channelId}`
      try {
        const response = await fetchMessagesPage({
          sourceKind,
          workspaceSlug,
          channelId,
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
    [sourceKind, workspaceSlug, channelId]
  )

  const sendMessage = useCallback(
    async (
      content: string,
      referencedMessage?: Message,
      attachments: NonNullable<Message["attachments"]> = []
    ) => {
      const trimmed = content.trim()
      if ((!trimmed && attachments.length === 0) || sendingRef.current) return
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
        content: trimmed || null,
        author: currentUser,
        attachments,
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
            content: trimmed || undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
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

  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!socket?.connected) {
        throw new Error("You're offline. Reconnect and try again.")
      }

      const previous = messagesRef.current.find(
        (message) => message.id === messageId
      )
      const editedAt = new Date().toISOString()
      setMessages((current) =>
        updateMessageContent(current, messageId, content, editedAt)
      )

      try {
        const result = await socket
          .timeout(12_000)
          .emitWithAck("message:edit", { channelId, messageId, content })
        if (!result.ok) throw new Error(result.error)
        setMessages((current) =>
          updateMessageContent(
            current,
            messageId,
            content,
            result.editedAt,
            result.mentions
          )
        )
      } catch (cause) {
        const isTimeout =
          cause instanceof Error && cause.message === "operation has timed out"
        const canonical = await reload({ replace: true, silent: true })
        // A timed-out ack can race a delivered edit; trust the refetched page.
        if (
          isTimeout &&
          canonical?.some(
            (message) => message.id === messageId && message.content === content
          )
        ) {
          return
        }
        // Reload failed too — put the pre-edit message back unless something
        // newer already replaced our optimistic content.
        if (!canonical && previous) {
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId &&
              message.content === content &&
              message.editedAt === editedAt
                ? previous
                : message
            )
          )
        }
        throw cause instanceof Error && !isTimeout
          ? cause
          : new Error("Could not edit this message. Please try again.")
      }
    },
    [socket, channelId, reload]
  )

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!socket?.connected) {
        throw new Error("You're offline. Reconnect and try again.")
      }

      const previous = messagesRef.current.find(
        (message) => message.id === messageId
      )
      setMessages((current) => removeMessage(current, messageId))

      try {
        const result = await socket
          .timeout(12_000)
          .emitWithAck("message:delete", { channelId, messageId })
        if (!result.ok) throw new Error(result.error)
      } catch (cause) {
        const isTimeout =
          cause instanceof Error && cause.message === "operation has timed out"
        const canonical = await reload({ replace: true, silent: true })
        // A timed-out ack can race a delivered delete; trust the refetched page.
        if (
          isTimeout &&
          canonical &&
          !canonical.some((message) => message.id === messageId)
        ) {
          return
        }
        // Reload failed too — restore the removed message.
        if (!canonical && previous) {
          setMessages((current) =>
            current.some((message) => message.id === messageId)
              ? current
              : mergeMessages([previous], current)
          )
        }
        throw cause instanceof Error && !isTimeout
          ? cause
          : new Error("Could not delete this message. Please try again.")
      }
    },
    [socket, channelId, reload]
  )

  const togglePin = useCallback(
    async (messageId: string, currentlyPinned: boolean) => {
      if (sourceKind !== "channel") return false
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
    [sourceKind, workspaceSlug, channelId]
  )

  return {
    messages,
    isLoading,
    error,
    isSending,
    reload,
    loadAround,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    togglePin,
  }
}
