import type { InferResponseType } from "@repo/api-client"
import type { RealtimeMessage, UnreadNotification } from "@repo/realtime-types"
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

// The person's chat list (reference/agents-and-chats.md, decisions 33, 35
// and 36): the chats they are in, each with its last message, who is in it
// and their own pin. Channel rows (name, agents, settings) stay in the
// ["channels"] query; this is what the list adds per person.

const chatsRoute = apiClient.v1.workspaces[":workspaceSlug"].chats

export type Chat = InferResponseType<
  typeof chatsRoute.$get,
  200
>["chats"][number]

export const chatsKey = (workspaceSlug: string) =>
  ["chats", workspaceSlug] as const

export function chatsQueryOptions(workspaceSlug: string) {
  return queryOptions({
    queryKey: chatsKey(workspaceSlug),
    queryFn: async () => {
      const res = await chatsRoute.$get({ param: { workspaceSlug }, query: {} })
      if (!res.ok) throw new Error("Failed to fetch chats")
      return (await res.json()).chats
    },
  })
}

export function useChats(workspaceSlug: string | undefined) {
  return useQuery({
    ...chatsQueryOptions(workspaceSlug ?? ""),
    enabled: Boolean(workspaceSlug),
  })
}

// The archived chats the person can see, which the sidebar adds, greyed,
// when asked to show them. Under chatsKey, so whatever refreshes the list
// refreshes this.
export function useArchivedChats(
  workspaceSlug: string | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: [...chatsKey(workspaceSlug ?? ""), "archived"],
    queryFn: async () => {
      const res = await chatsRoute.$get({
        param: { workspaceSlug: workspaceSlug ?? "" },
        query: { archived: "true" },
      })
      if (!res.ok) throw new Error("Failed to fetch archived chats")
      return (await res.json()).chats
    },
    enabled: enabled && Boolean(workspaceSlug),
  })
}

// The Discord channels agents are in that the person can see, which the
// sidebar adds when asked (decision 51).
export function usePlaceChats(
  workspaceSlug: string | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: [...chatsKey(workspaceSlug ?? ""), "places"],
    queryFn: async () => {
      const res = await chatsRoute.$get({
        param: { workspaceSlug: workspaceSlug ?? "" },
        query: { places: "true" },
      })
      if (!res.ok) throw new Error("Failed to fetch Discord channels")
      return (await res.json()).chats
    },
    enabled: enabled && Boolean(workspaceSlug),
  })
}

// When a chat last had something said in it: what Recent is ordered by.
export const chatActivityAt = (chat: Chat) =>
  chat.lastMessage?.createdAt ?? chat.createdAt

// Pinned chats in the order they were pinned, then the rest by last message.
// An archived chat is among the rest, whatever its pin.
export function orderChats(chats: Chat[]) {
  const isPinned = (chat: Chat) => Boolean(chat.pinnedAt) && !chat.archivedAt
  const pinned = chats
    .filter(isPinned)
    .sort((a, b) => (a.pinnedAt ?? "").localeCompare(b.pinnedAt ?? ""))
  const recent = chats
    .filter((chat) => !isPinned(chat))
    .sort((a, b) => chatActivityAt(b).localeCompare(chatActivityAt(a)))
  return { pinned, recent }
}

const REFETCH_AFTER_MS = 600

// Keeps the list current: a message someone else wrote moves its chat up
// with its preview at once, and the person's own send refetches. A chat
// that isn't in the list (hidden, or just joined) comes with a refetch.
export function useChatListUpdates(
  workspaceSlug: string | undefined,
  workspaceId: string | undefined
) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket || !workspaceSlug) return
    const key = chatsKey(workspaceSlug)
    let timer: ReturnType<typeof setTimeout> | undefined
    const refetchSoon = () => {
      clearTimeout(timer)
      timer = setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: key }),
        REFETCH_AFTER_MS
      )
    }
    const onUnread = (payload: UnreadNotification) => {
      if (payload.workspaceId !== workspaceId) return
      // Thread replies, session messages and event lines are not the chat's
      // last message.
      if (payload.threadRootId || payload.sessionId) return
      if (payload.messageType === "event") return
      const listed = queryClient
        .getQueryData<Chat[]>(key)
        ?.some((chat) => chat.id === payload.channelId)
      if (!listed) return refetchSoon()
      queryClient.setQueryData<Chat[]>(key, (chats) =>
        chats?.map((chat) =>
          chat.id === payload.channelId
            ? {
                ...chat,
                lastMessage: {
                  id: payload.messageId,
                  createdAt: new Date().toISOString(),
                  preview: payload.contentPreview ?? "sent a message",
                  authorId: payload.authorUserId,
                  authorName: payload.authorName,
                  // The row tells an agent by its author id.
                  agentId: null,
                },
              }
            : chat
        )
      )
    }
    // The open chat's own messages, the person's included: the server
    // writes the preview.
    const onCreated = (message: RealtimeMessage) => {
      if (!message.threadRootId) refetchSoon()
    }
    socket.on("notification:unread", onUnread)
    socket.on("message:created", onCreated)
    socket.on("channel:created", refetchSoon)
    return () => {
      clearTimeout(timer)
      socket.off("notification:unread", onUnread)
      socket.off("message:created", onCreated)
      socket.off("channel:created", refetchSoon)
    }
  }, [socket, queryClient, workspaceSlug, workspaceId])
}

// Pin or hide a chat for this person, shown before the server answers.
export function useUpdateChat(workspaceSlug: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      channelId: string
      pinned?: boolean
      hidden?: boolean
    }) => {
      const { channelId, ...json } = input
      const res = await chatsRoute[":channelId"].$patch({
        param: { workspaceSlug: workspaceSlug ?? "", channelId },
        json,
      })
      if (!res.ok) throw new Error("Failed to update the chat")
      return res.json()
    },
    onMutate: async (input) => {
      if (!workspaceSlug) return
      const key = chatsKey(workspaceSlug)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Chat[]>(key)
      queryClient.setQueryData<Chat[]>(key, (chats) =>
        chats?.flatMap((chat) => {
          if (chat.id !== input.channelId) return chat
          if (input.hidden) return []
          return input.pinned === undefined
            ? chat
            : {
                ...chat,
                pinnedAt: input.pinned ? new Date().toISOString() : null,
              }
        })
      )
      return { previous }
    },
    onError: (_error, _input, context) => {
      if (workspaceSlug && context?.previous) {
        queryClient.setQueryData(chatsKey(workspaceSlug), context.previous)
      }
    },
    onSettled: () => {
      if (workspaceSlug) {
        void queryClient.invalidateQueries({
          queryKey: chatsKey(workspaceSlug),
        })
      }
    },
  })
}
