import type { RealtimeMessageReactionUpdated } from "@repo/realtime-types"
import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo } from "react"
import { updateMessagesAcrossPages } from "@/lib/message-cache-utils"
import {
  applyReactionUpdateToMessage,
  toggleReactionOptimistically,
} from "@/lib/realtime-adapter"
import type { AppSocket } from "@/lib/socket"

type MessageWithReactions = Parameters<typeof toggleReactionOptimistically>[0]

interface MessagePage {
  data: MessageWithReactions[]
  root?: MessageWithReactions | null
}

interface UseMessageReactionsOptions {
  socket: AppSocket | null
  queryClient: QueryClient
  channelId: string
  threadRootId?: string
  currentUserId?: string
  currentUserName?: string
}

export function useMessageReactions({
  socket,
  queryClient,
  channelId,
  threadRootId,
  currentUserId,
  currentUserName,
}: UseMessageReactionsOptions) {
  const updateMessageInCache = useCallback(
    (
      messageId: string,
      updater: (message: MessageWithReactions) => MessageWithReactions
    ) => {
      const updateCache = (cacheKey: readonly unknown[]) => {
        queryClient.setQueryData<InfiniteData<MessagePage>>(cacheKey, (old) => {
          if (!old) return old

          const updated = updateMessagesAcrossPages(old, (msgs) =>
            msgs.map((message) =>
              message.id === messageId ? updater(message) : message
            )
          )

          return {
            ...updated,
            pages: updated.pages.map((page) =>
              page.root?.id === messageId
                ? { ...page, root: updater(page.root) }
                : page
            ),
          }
        })
      }

      updateCache(["messages", channelId])
      if (threadRootId) updateCache(["thread", threadRootId])
    },
    [queryClient, channelId, threadRootId]
  )

  const currentUser = useMemo(
    () =>
      currentUserId != null && currentUserName != null
        ? { id: currentUserId, name: currentUserName }
        : undefined,
    [currentUserId, currentUserName]
  )

  const toggleReactionLocal = useCallback(
    (messageId: string, emoji: string) => {
      updateMessageInCache(messageId, (message) =>
        toggleReactionOptimistically(message, emoji, currentUser)
      )
    },
    [updateMessageInCache, currentUser]
  )

  const applyReactionServerUpdate = useCallback(
    (update: RealtimeMessageReactionUpdated) => {
      updateMessageInCache(update.messageId, (message) =>
        applyReactionUpdateToMessage(message, update, currentUserId)
      )
    },
    [updateMessageInCache, currentUserId]
  )

  useEffect(() => {
    if (!socket) return

    const handleReactionUpdated = (update: RealtimeMessageReactionUpdated) => {
      if (update.channelId !== channelId) return
      applyReactionServerUpdate(update)
    }

    socket.on("message:reaction:updated", handleReactionUpdated)
    return () => {
      socket.off("message:reaction:updated", handleReactionUpdated)
    }
  }, [socket, channelId, applyReactionServerUpdate])

  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      if (!socket?.connected || !currentUserId) return

      toggleReactionLocal(messageId, emoji)

      socket.emit(
        "message:reaction:toggle",
        { channelId, messageId, emoji },
        (result) => {
          if (!result.ok) {
            console.error("[chat] toggle reaction failed:", result.error)
            toggleReactionLocal(messageId, emoji)
            return
          }

          applyReactionServerUpdate(result.update)
        }
      )
    },
    [
      socket,
      currentUserId,
      channelId,
      toggleReactionLocal,
      applyReactionServerUpdate,
    ]
  )

  return { handleReact }
}
