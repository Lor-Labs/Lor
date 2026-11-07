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

type EditHandler = (messageId: string, content: string) => void
type EditableRow = { createdAt: number; open: () => void }

// Up arrow in an empty composer edits the person's last message there. Rows
// register under the `onEdit` of the surface that lists them, so the channel
// and the thread panel each open only their own copy of a message.
const editableRows = new WeakMap<EditHandler, Map<string, EditableRow>>()

// A message row the person can edit now. `open` is undefined when they can't.
export function useEditableRow(
  onEdit: EditHandler | undefined,
  messageId: string,
  createdAt: string,
  open: (() => void) | undefined
) {
  useEffect(() => {
    if (!onEdit || !open) return
    let rows = editableRows.get(onEdit)
    if (!rows) {
      rows = new Map()
      editableRows.set(onEdit, rows)
    }
    const row = { createdAt: Date.parse(createdAt), open }
    rows.set(messageId, row)
    return () => {
      if (rows.get(messageId) === row) rows.delete(messageId)
    }
  }, [onEdit, messageId, createdAt, open])
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

  // Only rendered rows count, so an own message on an unloaded older page is
  // never opened.
  const editLastOwnMessage = useCallback(() => {
    let last: EditableRow | undefined
    for (const row of editableRows.get(handleEdit)?.values() ?? []) {
      if (!last || row.createdAt > last.createdAt) last = row
    }
    last?.open()
    return Boolean(last)
  }, [handleEdit])

  return { handleEdit, editLastOwnMessage }
}
