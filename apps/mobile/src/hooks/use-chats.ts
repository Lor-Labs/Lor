import type { InferResponseType } from "@repo/api-client"
import type { RealtimeMessage, UnreadNotification } from "@repo/realtime-types"
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import * as SecureStore from "expo-secure-store"
import { useToast } from "heroui-native/toast"
import { useCallback, useEffect, useState } from "react"
import { triggerHaptic } from "@/components/ui/haptics"
import { useSocket } from "@/context/socket-context"
import { api, responseMessage } from "@/lib/api"

// The person's chat list (reference/agents-and-chats.md, decisions 33, 35
// and 36): the chats they are in, each with its last message, who is in it
// and their own pin. Mirrors web's use-chats.ts.

const chatsRoute = api.v1.workspaces[":workspaceSlug"].chats

export type Chat = InferResponseType<
  typeof chatsRoute.$get,
  200
>["chats"][number]

export type ChatPerson = Chat["people"][number]

export const chatsKey = (workspaceSlug: string) =>
  ["chats", workspaceSlug] as const

async function fetchChats(
  workspaceSlug: string,
  query: { archived?: "true"; places?: "true" }
) {
  const res = await chatsRoute.$get({ param: { workspaceSlug }, query })
  if (!res.ok)
    throw new Error(await responseMessage(res, "Couldn't load chats"))
  return (await res.json()).chats
}

export function chatsQueryOptions(workspaceSlug: string) {
  return queryOptions({
    queryKey: chatsKey(workspaceSlug),
    queryFn: () => fetchChats(workspaceSlug, {}),
    enabled: Boolean(workspaceSlug),
  })
}

export function useChats(workspaceSlug: string | undefined) {
  return useQuery(chatsQueryOptions(workspaceSlug ?? ""))
}

// Archived chats the person can see, added greyed when the filter asks.
// Under chatsKey, so whatever refreshes the list refreshes these.
export function useArchivedChats(
  workspaceSlug: string | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: [...chatsKey(workspaceSlug ?? ""), "archived"],
    queryFn: () => fetchChats(workspaceSlug ?? "", { archived: "true" }),
    enabled: enabled && Boolean(workspaceSlug),
  })
}

// The Discord channels agents are in that the person can see (decision 51).
export function usePlaceChats(
  workspaceSlug: string | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: [...chatsKey(workspaceSlug ?? ""), "places"],
    queryFn: () => fetchChats(workspaceSlug ?? "", { places: "true" }),
    enabled: enabled && Boolean(workspaceSlug),
  })
}

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

const DAY_MS = 86_400_000

// When a chat was last active, as a chat list says it: the time today,
// then Yesterday, the weekday within a week, else the date.
export function chatTime(iso: string) {
  const at = new Date(iso)
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const days = Math.ceil((midnight.getTime() - at.getTime()) / DAY_MS)
  if (days <= 0)
    return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (days === 1) return "Yesterday"
  if (days < 7) return at.toLocaleDateString([], { weekday: "long" })
  return at.toLocaleDateString([], { month: "short", day: "numeric" })
}

const REFETCH_AFTER_MS = 600

// Keeps the list current: a message someone else wrote moves its chat up
// with its preview at once; the person's own send, a new chat or one that
// isn't listed yet comes with a refetch.
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
                  agentId: null,
                },
              }
            : chat
        )
      )
    }
    const onCreated = (message: RealtimeMessage) => {
      if (!message.threadRootId) refetchSoon()
    }
    socket.on("notification:unread", onUnread)
    socket.on("message:created", onCreated)
    socket.on("channel:created", refetchSoon)
    socket.on("connect", refetchSoon)
    return () => {
      clearTimeout(timer)
      socket.off("notification:unread", onUnread)
      socket.off("message:created", onCreated)
      socket.off("channel:created", refetchSoon)
      socket.off("connect", refetchSoon)
    }
  }, [socket, queryClient, workspaceSlug, workspaceId])
}

// Pin or hide a chat for this person, shown before the server answers.
export function useUpdateChat(workspaceSlug: string | undefined) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
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
      if (!res.ok)
        throw new Error(await responseMessage(res, "Couldn't change the chat"))
      return res.json()
    },
    onMutate: async (input) => {
      if (!workspaceSlug) return
      const key = chatsKey(workspaceSlug)
      await queryClient.cancelQueries({ queryKey: key, exact: true })
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
    onError: (error, _input, context) => {
      if (workspaceSlug && context?.previous) {
        queryClient.setQueryData(chatsKey(workspaceSlug), context.previous)
      }
      triggerHaptic("error")
      toast.show({ variant: "danger", label: error.message })
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

// Everything that shows a chat after it changed for everyone.
export function refreshChat(
  queryClient: QueryClient,
  workspaceSlug: string,
  channelId: string
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["channel", workspaceSlug, channelId],
    }),
    queryClient.invalidateQueries({
      queryKey: ["channels", workspaceSlug],
      exact: true,
    }),
    queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) }),
  ])
}

const chatRoute = chatsRoute[":channelId"]

// Archiving a chat for everyone, and undoing it (decision 52). Archiving
// offers Undo in its toast.
export function useChatArchive(workspaceSlug: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const fail = (error: Error) => {
    triggerHaptic("error")
    toast.show({ variant: "danger", label: error.message })
  }

  const unarchive = useMutation({
    mutationFn: async (input: { channelId: string }) => {
      const res = await chatRoute.unarchive.$post({
        param: { workspaceSlug, channelId: input.channelId },
      })
      if (!res.ok)
        throw new Error(
          await responseMessage(res, "Couldn't unarchive the chat")
        )
    },
    onSuccess: (_data, input) => {
      triggerHaptic("success")
      return refreshChat(queryClient, workspaceSlug, input.channelId)
    },
    onError: fail,
  })

  const archive = useMutation({
    mutationFn: async (input: { channelId: string; name: string | null }) => {
      const res = await chatRoute.archive.$post({
        param: { workspaceSlug, channelId: input.channelId },
      })
      if (!res.ok)
        throw new Error(await responseMessage(res, "Couldn't archive the chat"))
    },
    onSuccess: async (_data, input) => {
      triggerHaptic("success")
      toast.show({
        label: `Archived ${input.name ?? "the chat"}`,
        duration: 10_000,
        actionLabel: "Undo",
        onActionPress: ({ hide }) => {
          hide()
          unarchive.mutate({ channelId: input.channelId })
        },
      })
      await refreshChat(queryClient, workspaceSlug, input.channelId)
    },
    onError: fail,
  })

  return { archive, unarchive }
}

export const chatPeopleKey = (workspaceSlug: string, channelId: string) =>
  ["chat-people", workspaceSlug, channelId] as const

// Everyone in a chat (decision 35), kept live by the member lines the chat
// gets when someone joins, is added or leaves.
export function useChatPeople(workspaceSlug: string, channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    const onMessage = (message: RealtimeMessage) => {
      if (message.channelId !== channelId) return
      if (!message.eventType?.startsWith("member_")) return
      void queryClient.invalidateQueries({
        queryKey: chatPeopleKey(workspaceSlug, channelId),
      })
    }
    socket.on("message:created", onMessage)
    return () => {
      socket.off("message:created", onMessage)
    }
  }, [socket, queryClient, workspaceSlug, channelId])
  return useQuery({
    queryKey: chatPeopleKey(workspaceSlug, channelId),
    enabled: Boolean(workspaceSlug && channelId),
    queryFn: async () => {
      const res = await chatRoute.people.$get({
        param: { workspaceSlug, channelId },
      })
      if (!res.ok)
        throw new Error(
          await responseMessage(res, "Couldn't load the people in this chat")
        )
      return (await res.json()).people
    },
  })
}

// Adding people to a chat, joining it (adding yourself), and taking someone
// out of it, leaving included.
export function useChatPeopleChanges(workspaceSlug: string, channelId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: chatPeopleKey(workspaceSlug, channelId),
      }),
      queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) }),
    ])
  const fail = (error: Error) => {
    triggerHaptic("error")
    toast.show({ variant: "danger", label: error.message })
  }
  const add = useMutation({
    mutationFn: async (userIds: string[]) => {
      const res = await chatRoute.people.$post({
        param: { workspaceSlug, channelId },
        json: { userIds },
      })
      if (!res.ok)
        throw new Error(await responseMessage(res, "Couldn't add them"))
    },
    onSuccess: () => {
      triggerHaptic("success")
      return refresh()
    },
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const res = await chatRoute.people[":userId"].$delete({
        param: { workspaceSlug, channelId, userId },
      })
      if (!res.ok)
        throw new Error(await responseMessage(res, "Couldn't do that"))
    },
    onSuccess: refresh,
    onError: fail,
  })
  return { add, remove }
}

// What the list adds, per workspace, kept across launches: archived chats
// and places (the Discord channels agents are in).
export type ChatFilter = { archived: boolean; places: boolean }
const NO_FILTER: ChatFilter = { archived: false, places: false }
const filterKey = (workspaceSlug: string) =>
  `lor.chat-filter.${workspaceSlug.replace(/[^a-zA-Z0-9._-]/g, "_")}`

export function useChatFilter(workspaceSlug: string | undefined) {
  const [filter, setFilter] = useState<ChatFilter>(NO_FILTER)
  useEffect(() => {
    if (!workspaceSlug) return
    try {
      const stored = SecureStore.getItem(filterKey(workspaceSlug))
      setFilter(stored ? { ...NO_FILTER, ...JSON.parse(stored) } : NO_FILTER)
    } catch {
      setFilter(NO_FILTER)
    }
  }, [workspaceSlug])
  const set = useCallback(
    (kind: keyof ChatFilter, on: boolean) => {
      setFilter((previous) => {
        const next = { ...previous, [kind]: on }
        if (workspaceSlug) {
          void SecureStore.setItemAsync(
            filterKey(workspaceSlug),
            JSON.stringify(next)
          ).catch(() => undefined)
        }
        return next
      })
    },
    [workspaceSlug]
  )
  return [filter, set] as const
}
