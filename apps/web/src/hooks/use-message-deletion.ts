import type { ServerToClientEvents } from "@repo/realtime-types"
import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import { useCallback, useEffect } from "react"
import { updateMessagesAcrossPages } from "@/lib/message-cache-utils"
import type { AppSocket } from "@/lib/socket"

interface MessagePage {
  data: { id: string }[]
  root?: { id: string } | null
}

interface UseMessageDeletionOptions {
  socket: AppSocket | null
  queryClient: QueryClient
  channelId: string
  threadRootId?: string
}

export function useMessageDeletion({
  socket,
  queryClient,
  channelId,
  threadRootId,
}: UseMessageDeletionOptions) {
  const removeMessageFromCache = useCallback(
    (messageId: string) => {
      const updateCache = (key: readonly unknown[]) => {
        queryClient.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
          if (!old) return old
          const updated = updateMessagesAcrossPages(old, (messages) =>
            messages.filter((m) => m.id !== messageId)
          )
          return {
            ...updated,
            pages: updated.pages.map((page) =>
              page.root?.id === messageId ? { ...page, root: null } : page
            ),
          }
        })
      }
      updateCache(["messages", channelId])
      if (threadRootId) updateCache(["thread", threadRootId])
    },
    [queryClient, channelId, threadRootId]
  )

  // Listen for message:deleted from other clients
  useEffect(() => {
    if (!socket) return

    const handleDeleted: ServerToClientEvents["message:deleted"] = (
      payload
    ) => {
      if (payload.channelId !== channelId) return
      removeMessageFromCache(payload.messageId)
    }

    socket.on("message:deleted", handleDeleted)
    return () => {
      socket.off("message:deleted", handleDeleted)
    }
  }, [socket, channelId, removeMessageFromCache])

  const handleDelete = useCallback(
    (messageId: string) => {
      if (!socket?.connected) return

      // Optimistically remove from cache
      removeMessageFromCache(messageId)

      socket.emit("message:delete", { channelId, messageId }, (result) => {
        if (!result.ok) {
          console.error("[chat] delete message failed:", result.error)
          void queryClient.invalidateQueries({
            queryKey: ["messages", channelId],
          })
          if (threadRootId)
            void queryClient.invalidateQueries({
              queryKey: ["thread", threadRootId],
            })
        }
      })
    },
    [socket, channelId, threadRootId, removeMessageFromCache, queryClient]
  )

  return { handleDelete }
}
