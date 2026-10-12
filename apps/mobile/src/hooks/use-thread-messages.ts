import {
  type RealtimeMessage,
  type RealtimeMessageThreadUpdated,
  type ServerToClientEvents,
  sessionTitleFromPrompt,
} from "@repo/realtime-types"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { useChannelRoom } from "@/hooks/use-channel-room"
import {
  newSessionIds,
  type SessionStart,
  type SessionStartHandlers,
} from "@/hooks/use-session-start"
import { api } from "@/lib/api"
import type { Message, ThreadMessageList } from "@/lib/api-types"
import { lorMention, mentionsLor } from "@/lib/mentions"
import {
  applyReactionUpdate,
  applyThreadSummaryUpdate,
  createOptimisticMessage,
  isOptimisticMessage,
  mergeMessages,
  realtimeMessageToMessage,
  removeMessage,
  replaceMessage,
  rollbackOptimisticReply,
  updateMessageContent,
} from "@/lib/messages"
import {
  applyLorFrame,
  gateRunFrame,
  type LorFrame,
  releaseRunReplay,
  retainRunReplay,
  startRunReplay,
} from "@/lib/run-replay"
import type { AppSocket } from "@/lib/socket"
import { holdThreadRoom } from "@/lib/thread-rooms"

type CurrentUser = {
  id: string
  name: string
  image?: string | null
}

type ThreadParticipant = ThreadMessageList["participants"][number]

export type ThreadSnapshot = {
  messages: Message[]
  // Null for a Lor session: its root is a hidden anchor.
  root: Message | null
  participants: ThreadParticipant[]
  totalReplyCount: number
  beforeCursor: string | null
  reachedOldest: boolean
  // Set when the thread is a call's chat; the title once Lor summarized it.
  voiceSessionId: string | null
  voiceSessionTitle: string | null
}

function participantsFromMessages(
  root: Message | null,
  messages: Message[]
): ThreadParticipant[] {
  const participants = new Map<string, ThreadParticipant>()
  for (const message of root ? [root, ...messages] : messages) {
    if (!participants.has(message.author.id)) {
      participants.set(message.author.id, message.author)
    }
  }
  return [...participants.values()]
}

export function useThreadMessages({
  workspaceSlug,
  channelId,
  threadRootId,
  socket,
  currentUser,
  isSession = false,
  deferLoad = false,
  sessionStart,
}: {
  workspaceSlug: string
  channelId: string
  threadRootId: string
  socket: AppSocket | null
  currentUser?: CurrentUser
  isSession?: boolean
  // A session start the server hasn't confirmed: show the seeded snapshot
  // and wait, since the thread doesn't exist yet.
  deferLoad?: boolean
  // A human thread: @Lor starts a session seeded with the thread.
  sessionStart?: SessionStartHandlers
}) {
  const sessionStartRef = useRef(sessionStart)
  sessionStartRef.current = sessionStart
  useChannelRoom(socket, channelId)
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<Message[]>([])
  const [root, setRoot] = useState<Message | null>(null)
  const [participants, setParticipants] = useState<ThreadParticipant[]>([])
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null)
  const [voiceSessionTitle, setVoiceSessionTitle] = useState<string | null>(
    null
  )
  const [totalReplyCount, setTotalReplyCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [reachedOldest, setReachedOldest] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationError, setPaginationError] = useState<string | null>(null)
  const [isMissing, setIsMissing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const messagesRef = useRef<Message[]>([])
  const rootRef = useRef<Message | null>(null)
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
      const next = updater(rootRef.current)
      rootRef.current = next
      setRoot(next)
    },
    []
  )

  const applyFrame = useCallback(
    (frame: LorFrame) => {
      if (frame.payload.messageId === threadRootId) {
        updateRoot((current) =>
          current ? applyLorFrame(current, frame) : current
        )
        return
      }
      updateMessages((current) =>
        current.map((message) =>
          message.id === frame.payload.messageId
            ? applyLorFrame(message, frame)
            : message
        )
      )
    },
    [threadRootId, updateMessages, updateRoot]
  )

  const applyRunPatch = useCallback(
    (messageId: string, patch: Partial<Message>) => {
      if (messageId === threadRootId) {
        updateRoot((current) => (current ? { ...current, ...patch } : current))
        return
      }
      updateMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, ...patch } : message
        )
      )
    },
    [threadRootId, updateMessages, updateRoot]
  )

  // `replace` drops local state in favor of the fetched page — used on socket
  // reconnect so deletions missed while offline don't linger. `silent` skips
  // the loading state so already-rendered messages stay visible. Returns the
  // fetched page (or null on failure) so error paths can check canonical state.
  const reload = useCallback(
    async ({
      replace = false,
      silent = false,
    } = {}): Promise<{ data: Message[]; root: Message | null } | null> => {
      const requestId = ++requestRef.current
      const requestIdentity = `${workspaceSlug}:${channelId}:${threadRootId}`

      if (!workspaceSlug || !channelId || !threadRootId) {
        if (
          requestId === requestRef.current &&
          requestIdentity === identityRef.current
        ) {
          messagesRef.current = []
          rootRef.current = null
          beforeCursorRef.current = null
          setMessages([])
          setRoot(null)
          setParticipants([])
          setTotalReplyCount(0)
          setError(null)
          setIsMissing(true)
          setIsLoading(false)
          setIsRefreshing(false)
        }
        return null
      }

      if (silent) setIsRefreshing(true)
      else {
        setIsLoading(true)
        setIsRefreshing(false)
      }
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
            queryClient.removeQueries({ queryKey: ["thread", threadRootId] })
            updateRoot(() => null)
            setParticipants([])
            setIsMissing(true)
            return { data: [], root: null }
          }
          return null
        }
        if (!response.ok) throw new Error("Could not load this thread")

        const payload = await response.json()
        if (
          requestId === requestRef.current &&
          requestIdentity === identityRef.current
        ) {
          const nextParticipants = payload.participants?.length
            ? payload.participants
            : participantsFromMessages(payload.root, payload.data)
          const nextTotalReplyCount =
            payload.root?.threadSummary?.replyCount ?? payload.data.length
          // Replace still keeps unacked optimistic replies — dropping them
          // would make an in-flight send look already-reconciled to the
          // rollback guard and vanish without an error.
          updateMessages((current) =>
            mergeMessages(
              payload.data,
              replace ? current.filter(isOptimisticMessage) : current
            )
          )
          if (payload.root) updateRoot(() => payload.root)
          setParticipants(nextParticipants)
          setVoiceSessionId(payload.voiceSessionId)
          setVoiceSessionTitle(payload.voiceSessionTitle)
          beforeCursorRef.current = payload.beforeCursor
          setReachedOldest(payload.reachedOldest)
          setTotalReplyCount(nextTotalReplyCount)
          setIsMissing(!payload.root && !isSession)
          if (payload.root || isSession) {
            queryClient.setQueryData<ThreadSnapshot>(["thread", threadRootId], {
              messages: payload.data,
              root: payload.root ?? null,
              participants: nextParticipants,
              totalReplyCount: nextTotalReplyCount,
              beforeCursor: payload.beforeCursor,
              reachedOldest: payload.reachedOldest,
              voiceSessionId: payload.voiceSessionId,
              voiceSessionTitle: payload.voiceSessionTitle,
            })
          }
          return { data: payload.data, root: payload.root ?? null }
        }
        return null
      } catch (cause) {
        if (
          requestId === requestRef.current &&
          requestIdentity === identityRef.current
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load this thread"
          )
        }
        return null
      } finally {
        if (
          requestId === requestRef.current &&
          requestIdentity === identityRef.current
        ) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    },
    [
      workspaceSlug,
      channelId,
      threadRootId,
      isSession,
      queryClient,
      updateMessages,
      updateRoot,
    ]
  )

  // Seed from the last cached snapshot so reopening a thread renders
  // instantly; the silent replace-reload reconciles against the server.
  useEffect(() => {
    const cached = threadRootId
      ? queryClient.getQueryData<ThreadSnapshot>(["thread", threadRootId])
      : undefined
    const seeded = Boolean(cached && (cached.root || isSession))
    messagesRef.current = cached?.messages ?? []
    rootRef.current = cached?.root ?? null
    beforeCursorRef.current = cached?.beforeCursor ?? null
    setMessages(cached?.messages ?? [])
    setRoot(cached?.root ?? null)
    setParticipants(cached?.participants ?? [])
    setVoiceSessionId(cached?.voiceSessionId ?? null)
    setVoiceSessionTitle(cached?.voiceSessionTitle ?? null)
    setTotalReplyCount(cached?.totalReplyCount ?? 0)
    setIsRefreshing(false)
    setIsLoadingOlder(false)
    setReachedOldest(cached?.reachedOldest ?? true)
    setPaginationError(null)
    setIsMissing(false)
    loadingOlderRef.current = false
    if (seeded) setIsLoading(false)
    if (!deferLoad) void reload({ replace: seeded, silent: seeded })
  }, [reload, threadRootId, isSession, deferLoad, queryClient])

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
    if (!socket || !threadRootId || deferLoad) return

    const joinThread = () => {
      socket.emit("thread:join", { threadRootId })
    }
    const rejoinThread = () => {
      joinThread()
      void reload({ replace: true, silent: true })
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
      setParticipants((current) =>
        current.some((participant) => participant.id === received.author.id)
          ? current
          : [...current, received.author]
      )
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
            ? (updateMessageContent(
                [current],
                payload.messageId,
                payload.content,
                payload.editedAt,
                payload.mentions
              )[0] ?? current)
            : current
        )
        return
      }
      if (!messagesRef.current.some((item) => item.id === payload.messageId)) {
        return
      }
      updateMessages((current) =>
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
      if (
        payload.messageId !== threadRootId &&
        payload.threadRootId !== threadRootId
      ) {
        return
      }
      const frame: LorFrame = { type: "stream", payload }
      if (gateRunFrame(frame)) return
      applyFrame(frame)
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
    const updateReasoning: ServerToClientEvents["lor:reasoning"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      if (
        payload.messageId !== threadRootId &&
        payload.threadRootId !== threadRootId
      ) {
        return
      }
      const frame: LorFrame = { type: "reasoning", payload }
      if (gateRunFrame(frame)) return
      applyFrame(frame)
    }
    const updateTool: ServerToClientEvents["lor:tool"] = (payload) => {
      if (payload.channelId !== channelId) return
      if (
        payload.messageId !== threadRootId &&
        payload.threadRootId !== threadRootId
      ) {
        return
      }
      const frame: LorFrame = { type: "tool", payload }
      if (gateRunFrame(frame)) return
      applyFrame(frame)
    }
    // A mid-run send was absorbed by the active run — chip the sender's
    // message with what happened (steered vs queued).
    const routeMessage: ServerToClientEvents["message:routed"] = (payload) => {
      if (
        payload.channelId !== channelId ||
        payload.threadRootId !== threadRootId
      ) {
        return
      }
      updateMessages((current) =>
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
      updateMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? { ...message, routedOutcome: undefined }
            : message
        )
      )
    }
    // A steered message was injected — the placeholder shows who's steering.
    const steerMessage: ServerToClientEvents["lor:steer"] = (payload) => {
      if (payload.channelId !== channelId) return
      // Chip clear is ungated: chips aren't replayed state.
      updateMessages((current) =>
        current.map((message) =>
          message.id === payload.steeredMessageId
            ? { ...message, routedOutcome: undefined }
            : message
        )
      )
      if (
        payload.messageId !== threadRootId &&
        payload.threadRootId !== threadRootId
      ) {
        return
      }
      const frame: LorFrame = { type: "steer", payload }
      if (gateRunFrame(frame)) return
      applyFrame(frame)
    }
    const updateMemory: ServerToClientEvents["lor:memory"] = (payload) => {
      if (payload.channelId !== channelId) return
      if (
        payload.messageId !== threadRootId &&
        payload.threadRootId !== threadRootId
      ) {
        return
      }
      const frame: LorFrame = { type: "memory", payload }
      if (gateRunFrame(frame)) return
      applyFrame(frame)
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

    const releaseRoom = holdThreadRoom(socket, threadRootId)
    socket.on("connect", rejoinThread)
    socket.on("message:created", receiveMessage)
    socket.on("message:updated", updateMessage)
    socket.on("message:deleted", deleteMessage)
    socket.on("message:stream", streamMessage)
    socket.on("lor:reasoning", updateReasoning)
    socket.on("lor:tool", updateTool)
    socket.on("lor:memory", updateMemory)
    socket.on("message:routed", routeMessage)
    socket.on("run:queue:updated", settleQueued)
    socket.on("lor:steer", steerMessage)
    socket.on("message:embeds:updated", updateEmbeds)
    socket.on("message:reaction:updated", updateReaction)
    socket.on("message:pin:toggled", updatePin)
    socket.on("message:thread:updated", updateThread)

    return () => {
      releaseRoom()
      socket.off("connect", rejoinThread)
      socket.off("message:created", receiveMessage)
      socket.off("message:updated", updateMessage)
      socket.off("message:deleted", deleteMessage)
      socket.off("message:stream", streamMessage)
      socket.off("lor:reasoning", updateReasoning)
      socket.off("lor:tool", updateTool)
      socket.off("lor:memory", updateMemory)
      socket.off("message:routed", routeMessage)
      socket.off("run:queue:updated", settleQueued)
      socket.off("lor:steer", steerMessage)
      socket.off("message:embeds:updated", updateEmbeds)
      socket.off("message:reaction:updated", updateReaction)
      socket.off("message:pin:toggled", updatePin)
      socket.off("message:thread:updated", updateThread)
    }
  }, [
    socket,
    channelId,
    threadRootId,
    deferLoad,
    reload,
    updateMessages,
    updateRoot,
    currentUser?.id,
    applyFrame,
  ])

  // Late-join trace recovery: replay the durable event log of any pending
  // Lor placeholder in view — root included (no-ops for already-started
  // replays). Started replays are released on unmount — this hook's message
  // state dies with it, so a remount mid-run must be able to replay again.
  const startedReplays = useRef(new Set<string>())
  useEffect(() => {
    const candidates = root ? [root, ...messages] : messages
    for (const message of candidates) {
      if (message.status !== "pending") continue
      if (!startedReplays.current.has(message.id)) {
        startedReplays.current.add(message.id)
        retainRunReplay(message.id)
      }
      startRunReplay({
        messageId: message.id,
        applyPatch: applyRunPatch,
        applyFrame,
        onTerminal: () => void reload({ silent: true }),
      })
    }
  }, [root, messages, applyRunPatch, applyFrame, reload])
  useEffect(
    () => () => {
      for (const id of startedReplays.current) releaseRunReplay(id)
    },
    []
  )

  const sendMessage = useCallback(
    async (
      content: string,
      referencedMessage?: Message,
      attachments: NonNullable<Message["attachments"]> = [],
      // Invoked with the optimistic reply's id (the send nonce) before the
      // socket round trip — lets callers mirror the send into other
      // optimistic state (e.g. the run queue pill).
      onOptimistic?: (id: string) => void
    ) => {
      const trimmed = content.trim()
      if ((!trimmed && attachments.length === 0) || sendingRef.current) return
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
      const handlers = sessionStartRef.current
      const startIds = handlers && mentionsLor(trimmed) ? newSessionIds() : null
      const start: SessionStart | null = startIds
        ? {
            ...startIds,
            title: sessionTitleFromPrompt(trimmed),
            message: {
              ...createOptimisticMessage({
                nonce,
                channelId,
                content: trimmed || null,
                author: currentUser,
                attachments,
                threadRootId: startIds.threadRootId,
              }),
              mentions: [lorMention],
            },
          }
        : null
      sendingRef.current = true
      if (start) {
        handlers?.starting(start)
      } else {
        const optimistic = createOptimisticMessage({
          nonce,
          channelId,
          content: trimmed || null,
          author: currentUser,
          attachments,
          threadRootId,
          referencedMessage: referencedMessage
            ? {
                id: referencedMessage.id,
                content: referencedMessage.content,
                author: referencedMessage.author,
                overrideName: referencedMessage.overrideName,
                overrideAvatarUrl: referencedMessage.overrideAvatarUrl,
                mentions: referencedMessage.mentions,
              }
            : null,
        })
        updateMessages((current) => mergeMessages([optimistic], current))
        setTotalReplyCount((current) => current + 1)
        onOptimistic?.(nonce)
      }
      setIsSending(true)

      try {
        const result = await socket
          .timeout(12_000)
          .emitWithAck("message:send", {
            channelId,
            content: trimmed || undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
            nonce,
            threadRootId,
            referencedMessageId: referencedMessage?.id,
            newSession: startIds ?? undefined,
          })
        if (!result.ok) throw new Error(result.error)

        const confirmed = realtimeMessageToMessage(result.message)
        if (start) {
          // The server moved the message into a new Lor session.
          if (confirmed.threadRootId !== threadRootId && result.session) {
            handlers?.started(start, result.session, confirmed)
            return
          }
          handlers?.failed(start)
          setTotalReplyCount((current) => current + 1)
        }
        updateMessages((current) => replaceMessage(current, nonce, confirmed))
        setParticipants((current) =>
          current.some((participant) => participant.id === confirmed.author.id)
            ? current
            : [...current, confirmed.author]
        )
      } catch (cause) {
        if (start) {
          handlers?.failed(start)
        } else {
          // If message:created already reconciled the optimistic reply (e.g.
          // the ack timed out after delivery), the send succeeded — don't
          // roll back.
          if (!messagesRef.current.some((message) => message.id === nonce)) {
            return
          }
          updateMessages(
            (current) => rollbackOptimisticReply(current, nonce, 1).messages
          )
          setTotalReplyCount(
            (current) =>
              rollbackOptimisticReply([], nonce, current).totalReplyCount
          )
        }
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

  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!socket?.connected) {
        throw new Error("You're offline. Reconnect and try again.")
      }

      const previousRoot = rootRef.current
      const previousMessage = messagesRef.current.find(
        (message) => message.id === messageId
      )
      const editedAt = new Date().toISOString()
      if (messageId === threadRootId) {
        updateRoot((current) =>
          current
            ? (updateMessageContent(
                [current],
                messageId,
                content,
                editedAt
              )[0] ?? current)
            : current
        )
      } else {
        updateMessages((current) =>
          updateMessageContent(current, messageId, content, editedAt)
        )
      }

      try {
        const result = await socket
          .timeout(12_000)
          .emitWithAck("message:edit", { channelId, messageId, content })
        if (!result.ok) throw new Error(result.error)
        if (messageId === threadRootId) {
          updateRoot((current) =>
            current
              ? (updateMessageContent(
                  [current],
                  messageId,
                  content,
                  result.editedAt,
                  result.mentions
                )[0] ?? current)
              : current
          )
        } else {
          updateMessages((current) =>
            updateMessageContent(
              current,
              messageId,
              content,
              result.editedAt,
              result.mentions
            )
          )
        }
      } catch (cause) {
        const isTimeout =
          cause instanceof Error && cause.message === "operation has timed out"
        const canonical = await reload({ replace: true, silent: true })
        // A timed-out ack can race a delivered edit; trust the refetched page.
        const editApplied =
          messageId === threadRootId
            ? canonical?.root?.content === content
            : canonical?.data.some(
                (message) =>
                  message.id === messageId && message.content === content
              )
        if (isTimeout && editApplied) return
        // Reload failed too — put the pre-edit message back unless something
        // newer already replaced our optimistic content.
        if (!canonical) {
          if (messageId === threadRootId && previousRoot) {
            updateRoot((current) =>
              current?.id === messageId && current.content === content
                ? previousRoot
                : current
            )
          } else if (previousMessage) {
            updateMessages((current) =>
              current.map((message) =>
                message.id === messageId &&
                message.content === content &&
                message.editedAt === editedAt
                  ? previousMessage
                  : message
              )
            )
          }
        }
        throw cause instanceof Error && !isTimeout
          ? cause
          : new Error("Could not edit this message. Please try again.")
      }
    },
    [socket, channelId, threadRootId, reload, updateMessages, updateRoot]
  )

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!socket?.connected) {
        throw new Error("You're offline. Reconnect and try again.")
      }

      const previousRoot = rootRef.current
      const previousMessage = messagesRef.current.find(
        (message) => message.id === messageId
      )
      if (messageId === threadRootId) {
        updateRoot(() => null)
        setIsMissing(true)
      } else {
        updateMessages((current) => removeMessage(current, messageId))
        if (previousMessage) {
          setTotalReplyCount((current) => Math.max(0, current - 1))
        }
      }

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
        const deletionApplied =
          messageId === threadRootId
            ? canonical !== null && canonical.root === null
            : canonical !== null &&
              !canonical.data.some((message) => message.id === messageId)
        if (isTimeout && deletionApplied) return
        // Reload failed too — restore the removed message.
        if (!canonical) {
          if (messageId === threadRootId && previousRoot) {
            updateRoot(() => previousRoot)
            setIsMissing(false)
          } else if (
            previousMessage &&
            !messagesRef.current.some((message) => message.id === messageId)
          ) {
            updateMessages((current) =>
              mergeMessages([previousMessage], current)
            )
            setTotalReplyCount((current) => current + 1)
          }
        }
        throw cause instanceof Error && !isTimeout
          ? cause
          : new Error("Could not delete this message. Please try again.")
      }
    },
    [socket, channelId, threadRootId, reload, updateMessages, updateRoot]
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
    participants,
    voiceSessionId,
    voiceSessionTitle,
    totalReplyCount,
    isLoading,
    isRefreshing,
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
    editMessage,
    deleteMessage,
    toggleReaction,
    togglePin,
  }
}
