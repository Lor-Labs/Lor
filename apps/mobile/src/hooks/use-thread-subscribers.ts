import type { RealtimeMessageThreadUpdated } from "@repo/realtime-types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo } from "react"
import { Alert } from "react-native"
import { useSocket } from "@/context/socket-context"
import {
  cancelSidebarFetch,
  patchSidebarSession,
  sidebarRowFor,
  sidebarSessionMutationKey,
  workspaceActivityKey,
} from "@/hooks/use-workspace-activity"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import { api } from "@/lib/api"
import type { AgentSession } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export type ThreadSubscriber = {
  id: string
  name: string
  image: string | null
  avatarColor: string | null
}

type ThreadRef = {
  workspaceSlug: string
  channelId: string
  threadRootId: string
}

// Same key as web.
export const threadSubscribersKey = (threadRootId: string) =>
  ["thread-subscribers", threadRootId] as const

// Read-only callers (the session composer's faces) share the list with
// useThreadSubscribers, which keeps it live.
export function threadSubscribersQueryOptions({
  workspaceSlug,
  channelId,
  threadRootId,
}: ThreadRef) {
  return {
    queryKey: threadSubscribersKey(threadRootId),
    enabled: Boolean(workspaceSlug && channelId && threadRootId),
    queryFn: async (): Promise<ThreadSubscriber[]> => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].threads[":threadRootId"].subscribers.$get({
        param: { workspaceSlug, channelId, threadRootId },
      })
      if (!res.ok) throw new Error("Failed to fetch subscribers")
      const body = await res.json()
      return body.subscribers
    },
  }
}

// Under the sidebar key: following a session moves its Channels-tab row.
const subscriberMutationKey = (threadRootId: string) =>
  [...sidebarSessionMutationKey, "subscribers", threadRootId] as const

// Who follows a session or thread: its Channels-tab row and notifications
// reach them. Writes are optimistic, and following or leaving a session
// moves its row at once. Refetches wait while a change is in flight, so
// quick ticks never flicker back. Mirrors web's use-thread-subscribers.ts.
export function useThreadSubscribers({
  workspaceSlug,
  channelId,
  threadRootId,
  session,
}: ThreadRef & { session?: AgentSession }) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data: auth } = authClient.useSession()
  const currentUserId = auth?.user.id
  const queryKey = threadSubscribersKey(threadRootId)
  const mutationKey = subscriberMutationKey(threadRootId)

  const { data: subscribers = [] } = useQuery(
    threadSubscribersQueryOptions({ workspaceSlug, channelId, threadRootId })
  )

  // Replies and mentions subscribe people; the subscriber routes emit
  // workspace activity.
  useEffect(() => {
    if (!socket) return
    const refresh = () => {
      if (
        queryClient.isMutating({
          mutationKey: subscriberMutationKey(threadRootId),
        }) > 0
      ) {
        return
      }
      void queryClient.invalidateQueries({
        queryKey: threadSubscribersKey(threadRootId),
      })
    }
    const onThreadUpdated = (payload: RealtimeMessageThreadUpdated) => {
      if (payload.threadRootId === threadRootId) refresh()
    }
    socket.on("message:thread:updated", onThreadUpdated)
    socket.on("workspace:activity:updated", refresh)
    return () => {
      socket.off("message:thread:updated", onThreadUpdated)
      socket.off("workspace:activity:updated", refresh)
    }
  }, [socket, queryClient, threadRootId])

  const moveSidebarRow = (show: boolean) => {
    if (!session || session.archivedAt) return
    patchSidebarSession(
      queryClient,
      {
        workspaceId: session.workspaceId,
        channelId: session.channelId,
        sessionId: session.id,
      },
      show ? { show: sidebarRowFor(session) } : { hide: true }
    )
  }

  // The last change in flight refetches; earlier ones would overwrite the
  // later optimistic ticks.
  const settle = () => {
    if (queryClient.isMutating({ mutationKey }) > 1) return
    void queryClient.invalidateQueries({ queryKey })
    if (session) {
      void queryClient.invalidateQueries({
        queryKey: workspaceActivityKey(session.workspaceId),
      })
    }
  }

  const mutation = useMutation({
    mutationKey,
    mutationFn: async (input: {
      person: ThreadSubscriber
      subscribed: boolean
    }) => {
      const endpoint =
        api.v1.workspaces[":workspaceSlug"].channels[":channelId"].threads[
          ":threadRootId"
        ].subscribers[":userId"]
      const param = {
        workspaceSlug,
        channelId,
        threadRootId,
        userId: input.person.id,
      }
      const res = input.subscribed
        ? await endpoint.$put({ param })
        : await endpoint.$delete({ param })
      if (!res.ok) throw new Error("Couldn't change subscribers")
    },
    onMutate: async ({ person, subscribed }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey }),
        session && cancelSidebarFetch(queryClient, session.workspaceId),
      ])
      const previous = queryClient.getQueryData<ThreadSubscriber[]>(queryKey)
      queryClient.setQueryData<ThreadSubscriber[]>(queryKey, (current = []) => {
        const others = current.filter(
          (subscriber) => subscriber.id !== person.id
        )
        return subscribed ? [...others, person] : others
      })
      if (person.id === currentUserId) moveSidebarRow(subscribed)
      return { previous }
    },
    onError: (error, _input, context) => {
      queryClient.setQueryData(queryKey, context?.previous)
      Alert.alert(error.message, "Please try again in a moment.")
    },
    onSettled: settle,
  })

  // "Everyone in #channel": the server subscribes the whole audience; the
  // list shows the channel's people at once.
  const everyone = useMutation({
    mutationKey,
    mutationFn: async (_people: ThreadSubscriber[]) => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].threads[":threadRootId"].subscribers.everyone.$post({
        param: { workspaceSlug, channelId, threadRootId },
      })
      if (!res.ok) throw new Error("Couldn't subscribe the channel")
    },
    onMutate: async (people) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey }),
        session && cancelSidebarFetch(queryClient, session.workspaceId),
      ])
      const previous = queryClient.getQueryData<ThreadSubscriber[]>(queryKey)
      const current = previous ?? []
      const known = new Set(current.map((subscriber) => subscriber.id))
      queryClient.setQueryData<ThreadSubscriber[]>(queryKey, [
        ...current,
        ...people.filter((person) => !known.has(person.id)),
      ])
      if (currentUserId && !known.has(currentUserId)) moveSidebarRow(true)
      return { previous }
    },
    onError: (error, _people, context) => {
      queryClient.setQueryData(queryKey, context?.previous)
      Alert.alert(error.message, "Please try again in a moment.")
    },
    onSettled: settle,
  })

  return {
    subscribers,
    setSubscribed: (person: ThreadSubscriber, subscribed: boolean) =>
      mutation.mutate({ person, subscribed }),
    subscribeEveryone: (people: ThreadSubscriber[]) => everyone.mutate(people),
  }
}

// The people who can see a channel (bots left out): who a session's
// subscribers can be. Same keys as web's useChannelPeople.
export function useChannelPeople(workspaceSlug: string, channelId: string) {
  const { members } = useWorkspaceMembers(workspaceSlug)
  const { data: audience } = useQuery({
    queryKey: ["channel", workspaceSlug, channelId, "audience"],
    enabled: Boolean(workspaceSlug && channelId),
    queryFn: async () => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].audience.$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Failed to fetch channel audience")
      return res.json()
    },
  })
  return useMemo(() => {
    const audienceIds = new Set(audience?.userIds ?? [])
    return members
      .filter((member) => !member.isBot && audienceIds.has(member.userId))
      .map(
        (member): ThreadSubscriber => ({
          id: member.userId,
          name: member.name,
          image: member.image,
          avatarColor: member.avatarColor,
        })
      )
  }, [members, audience])
}
