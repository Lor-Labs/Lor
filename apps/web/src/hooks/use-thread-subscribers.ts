import { authClient } from "@repo/auth/client"
import type {
  RealtimeAgentSession,
  RealtimeMessageThreadUpdated,
} from "@repo/realtime-types"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"
import { setSessionOverlay, sidebarRowFor } from "@/lib/sidebar-session-overlay"

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

export const threadSubscribersKey = (threadRootId: string) =>
  ["thread-subscribers", threadRootId] as const

// Who follows a session or thread: its sidebar row and notifications reach
// them. Writes are optimistic, and following or leaving a session moves its
// sidebar row at once. Refetches wait while a change is in flight, so quick
// ticks in the picker never flicker back.
export function useThreadSubscribers({
  workspaceSlug,
  channelId,
  threadRootId,
  session,
}: ThreadRef & { session?: RealtimeAgentSession }) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data: auth } = authClient.useSession()
  const currentUserId = auth?.user.id
  const queryKey = threadSubscribersKey(threadRootId)

  const { data: subscribers = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].threads[":threadRootId"].subscribers.$get({
        param: { workspaceSlug, channelId, threadRootId },
      })
      if (!res.ok) throw new Error("Failed to fetch subscribers")
      const body = await res.json()
      return body.subscribers
    },
  })

  // Replies and mentions subscribe people; the subscriber routes emit
  // workspace activity.
  useEffect(() => {
    if (!socket) return
    const refresh = () => {
      const key = threadSubscribersKey(threadRootId)
      if (queryClient.isMutating({ mutationKey: key }) > 0) return
      void queryClient.invalidateQueries({ queryKey: key })
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

  const mutation = useMutation({
    mutationKey: queryKey,
    mutationFn: async (input: {
      person: ThreadSubscriber
      subscribed: boolean
    }) => {
      const endpoint =
        apiClient.v1.workspaces[":workspaceSlug"].channels[":channelId"]
          .threads[":threadRootId"].subscribers[":userId"]
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
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ThreadSubscriber[]>(queryKey)
      queryClient.setQueryData<ThreadSubscriber[]>(queryKey, (current = []) => {
        const others = current.filter(
          (subscriber) => subscriber.id !== person.id
        )
        return subscribed ? [...others, person] : others
      })
      if (session && !session.archivedAt && person.id === currentUserId) {
        setSessionOverlay(
          session.id,
          subscribed
            ? {
                kind: "show",
                channelId: session.channelId,
                row: sidebarRowFor(session),
              }
            : { kind: "hide", channelId: session.channelId }
        )
      }
      return { previous }
    },
    onError: (err, { person }, context) => {
      queryClient.setQueryData(queryKey, context?.previous)
      if (session && person.id === currentUserId) {
        setSessionOverlay(session.id, null)
      }
      toast.error(err.message)
    },
    // The last change in flight refetches; earlier ones would overwrite the
    // later optimistic ticks.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: queryKey }) <= 1) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  })

  return {
    subscribers,
    setSubscribed: (person: ThreadSubscriber, subscribed: boolean) =>
      mutation.mutate({ person, subscribed }),
  }
}
