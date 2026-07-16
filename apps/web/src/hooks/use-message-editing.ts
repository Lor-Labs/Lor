import type { RealtimeMessageMention } from "@repo/realtime-types"
import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import { useCallback, useEffect } from "react"
import { updateMessagesAcrossPages } from "@/lib/message-cache-utils"
import type { AppSocket } from "@/lib/socket"

interface MessagePage {
  data: {
    id: string
    content: string | null
    editedAt: string | null
    mentions?: RealtimeMessageMention[]
  }[]
}

interface UseMessageEditingOptions {
  socket: AppSocket | null
  queryClient: QueryClient
  channelId: string
}

export function useMessageEditing({
  socket,
  queryClient,
  channelId,
}: UseMessageEditingOptions) {
  const updateMessageInCache = useCallback(
    (
      messageId: string,
      content: string,
      editedAt: string,
      mentions?: RealtimeMessageMention[]
    ) => {
      queryClient.setQueryData<InfiniteData<MessagePage>>(
        ["messages", channelId],
        (old) => {
          if (!old) return old
          return updateMessagesAcrossPages(old, (msgs) =>
            msgs.map((m) =>
              m.id === messageId
                ? { ...m, content, editedAt, mentions: mentions ?? m.mentions }
                : m
            )
          )
        }
      )
    },
    [queryClient, channelId]
  )

  useEffect(() => {
    if (!socket) return

    const handleUpdated = (payload: {
      channelId: string
      messageId: string
      content: string
      editedAt: string
      mentions: RealtimeMessageMention[]
    }) => {
      if (payload.channelId !== channelId) return
      updateMessageInCache(
        payload.messageId,
        payload.content,
        payload.editedAt,
        payload.mentions
      )
    }

    socket.on("message:updated", handleUpdated)
    return () => {
      socket.off("message:updated", handleUpdated)
    }
  }, [socket, channelId, updateMessageInCache])

  const handleEdit = useCallback(
    (messageId: string, content: string) => {
      if (!socket?.connected) return

      const editedAt = new Date().toISOString()
      updateMessageInCache(messageId, content, editedAt)

      socket.emit(
        "message:edit",
        { channelId, messageId, content },
        (result) => {
          if (!result.ok) {
            console.error("[chat] edit message failed:", result.error)
            void queryClient.invalidateQueries({
              queryKey: ["messages", channelId],
            })
            return
          }
          updateMessageInCache(
            messageId,
            content,
            result.editedAt,
            result.mentions
          )
        }
      )
    },
    [socket, channelId, updateMessageInCache, queryClient]
  )

  return { handleEdit }
}
