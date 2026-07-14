import type { RealtimeMessageMention } from "@repo/realtime-types"
import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { updateMessagesAcrossPages } from "@/lib/message-cache-utils"
import type { AppSocket } from "@/lib/socket"

type ReasoningSegment = {
  text: string
  at: number
  order: number
}

type ToolCall = {
  toolCallId: string
  toolName: string
  label: string
  at?: number
  order?: number
  parentToolCallId?: string
  detail?: { summary?: string; items?: { title: string; url?: string }[] }
  status?: "ok" | "error"
}

interface MessagePage {
  data: {
    id: string
    content: string | null
    streaming?: boolean
    status?: "pending" | "complete" | "failed"
    remembered?: { path: string; action: "created" | "updated" }[]
    merlinToolCalls?: ToolCall[]
    merlinReasoning?: string | null
    merlinReasoningSegments?: ReasoningSegment[]
    mentions?: RealtimeMessageMention[]
  }[]
}

interface UseMerlinStreamOptions {
  socket: AppSocket | null
  queryClient: QueryClient
  channelId: string
}

// Appends Merlin's streamed reply deltas into its placeholder message and
// toggles a transient `streaming` flag (for the thinking/typing indicator).
export function useMerlinStream({
  socket,
  queryClient,
  channelId,
}: UseMerlinStreamOptions) {
  useEffect(() => {
    if (!socket) return

    const handleStream = (payload: {
      channelId: string
      threadRootId: string | null
      messageId: string
      delta: string
      done: boolean
      status?: "complete" | "failed"
      replace?: boolean
      mentions?: RealtimeMessageMention[]
    }) => {
      if (payload.channelId !== channelId) return
      // Patch the thread cache when the reply lives in a thread, else the channel feed.
      const key = payload.threadRootId
        ? ["thread", payload.threadRootId]
        : ["messages", channelId]
      queryClient.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
        if (!old) return old
        return updateMessagesAcrossPages(old, (msgs) =>
          msgs.map((m) =>
            m.id === payload.messageId
              ? {
                  ...m,
                  content: payload.replace
                    ? payload.delta
                    : (m.content ?? "") + payload.delta,
                  streaming: !payload.done,
                  ...(payload.status ? { status: payload.status } : {}),
                  ...(payload.mentions ? { mentions: payload.mentions } : {}),
                }
              : m
          )
        )
      })
    }

    socket.on("message:stream", handleStream)
    return () => {
      socket.off("message:stream", handleStream)
    }
  }, [socket, channelId, queryClient])

  useEffect(() => {
    if (!socket) return

    const handleReasoning = (payload: {
      channelId: string
      threadRootId: string | null
      messageId: string
      delta: string
      at: number
      order: number
    }) => {
      if (payload.channelId !== channelId) return
      const key = payload.threadRootId
        ? ["thread", payload.threadRootId]
        : ["messages", channelId]
      queryClient.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
        if (!old) return old
        return updateMessagesAcrossPages(old, (msgs) =>
          msgs.map((m) => {
            if (m.id !== payload.messageId) return m
            const segments = m.merlinReasoningSegments ?? []
            const existingIndex = segments.findIndex(
              (segment) => segment.order === payload.order
            )
            const merlinReasoningSegments =
              existingIndex >= 0
                ? segments.map((segment, index) =>
                    index === existingIndex
                      ? { ...segment, text: segment.text + payload.delta }
                      : segment
                  )
                : [
                    ...segments,
                    {
                      text: payload.delta,
                      at: payload.at,
                      order: payload.order,
                    },
                  ]
            return {
              ...m,
              merlinReasoning: (m.merlinReasoning ?? "") + payload.delta,
              merlinReasoningSegments,
              streaming: true,
            }
          })
        )
      })
    }

    socket.on("merlin:reasoning", handleReasoning)
    return () => {
      socket.off("merlin:reasoning", handleReasoning)
    }
  }, [socket, channelId, queryClient])

  useEffect(() => {
    if (!socket) return

    const handleMemory = (payload: {
      channelId: string
      threadRootId: string | null
      messageId: string
      path: string
      action: "created" | "updated"
    }) => {
      if (payload.channelId !== channelId) return
      const key = payload.threadRootId
        ? ["thread", payload.threadRootId]
        : ["messages", channelId]
      queryClient.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
        if (!old) return old
        return updateMessagesAcrossPages(old, (msgs) =>
          msgs.map((m) =>
            m.id === payload.messageId
              ? {
                  ...m,
                  remembered: [
                    ...(m.remembered ?? []).filter(
                      (r) => r.path !== payload.path
                    ),
                    { path: payload.path, action: payload.action },
                  ],
                }
              : m
          )
        )
      })
    }

    socket.on("merlin:memory", handleMemory)
    return () => {
      socket.off("merlin:memory", handleMemory)
    }
  }, [socket, channelId, queryClient])

  useEffect(() => {
    if (!socket) return

    const handleTool = (payload: {
      channelId: string
      threadRootId: string | null
      messageId: string
      toolCall: ToolCall
    }) => {
      if (payload.channelId !== channelId) return
      const key = payload.threadRootId
        ? ["thread", payload.threadRootId]
        : ["messages", channelId]
      queryClient.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
        if (!old) return old
        return updateMessagesAcrossPages(old, (msgs) =>
          msgs.map((m) => {
            if (m.id !== payload.messageId) return m
            // Upsert into the same trail the server persists, so live and
            // reloaded renders match (start adds the row, completion fills detail).
            const existing = m.merlinToolCalls ?? []
            const idx = existing.findIndex(
              (t) => t.toolCallId === payload.toolCall.toolCallId
            )
            const merlinToolCalls =
              idx >= 0
                ? existing.map((t, i) => (i === idx ? payload.toolCall : t))
                : [...existing, payload.toolCall]
            return { ...m, merlinToolCalls }
          })
        )
      })
    }

    socket.on("merlin:tool", handleTool)
    return () => {
      socket.off("merlin:tool", handleTool)
    }
  }, [socket, channelId, queryClient])
}
