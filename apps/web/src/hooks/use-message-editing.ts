import type {
  RealtimeMessageMention,
  ServerToClientEvents,
} from "@repo/realtime-types"
import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import { useCallback, useEffect } from "react"
import { updateMessagesAcrossPages } from "@/lib/message-cache-utils"
import type { AppSocket } from "@/lib/socket"

type EditableMessage = {
  id: string
  content: string | null
  editedAt: string | null
  mentions?: RealtimeMessageMention[]
}
interface MessagePage {
  data: EditableMessage[]
  root?: EditableMessage | null
}

interface UseMessageEditingOptions {
  socket: AppSocket | null
  queryClient: QueryClient
  channelId: string
  threadRootId?: string
}

export function useMessageEditing({
  socket,
  queryClient,
  channelId,
  threadRootId,
}: UseMessageEditingOptions) {
  const updateMessageInCache = useCallback(
    (
      messageId: string,
      content: string,
      editedAt: string,
      mentions?: RealtimeMessageMention[]
    ) => {
      const update = (message: EditableMessage) =>
        message.id === messageId
          ? {
              ...message,
              content,
              editedAt,
              mentions: mentions ?? message.mentions,
            }
          : message
      const updateCache = (key: readonly unknown[]) => {
        queryClient.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
          if (!old) return old
          const updated = updateMessagesAcrossPages(old, (messages) =>
            messages.map(update)
          )
          return {
            ...updated,
            pages: updated.pages.map((page) => ({
              ...page,
              ...(page.root ? { root: update(page.root) } : {}),
            })),
          }
        })
      }
      updateCache(["messages", channelId])
      if (threadRootId) updateCache(["thread", threadRootId])
    },
    [queryClient, channelId, threadRootId]
  )

  useEffect(() => {
    if (!socket) return

    const handleUpdated: ServerToClientEvents["message:updated"] = (
      payload
    ) => {
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
            if (threadRootId)
              void queryClient.invalidateQueries({
                queryKey: ["thread", threadRootId],
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
    [socket, channelId, threadRootId, updateMessageInCache, queryClient]
  )

  return { handleEdit }
}
