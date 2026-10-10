import { authClient } from "@repo/auth/client"
import type {
  AgentSessionUpdatedEvent,
  RealtimeAgentSession,
} from "@repo/realtime-types"
import { toast } from "@repo/ui/components/toast"
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import {
  type ChannelSession,
  channelSessionsKey,
} from "@/hooks/use-channel-sessions"
import {
  type ThreadSubscriber,
  threadSubscribersKey,
} from "@/hooks/use-thread-subscribers"
import {
  cancelSidebarFetch,
  patchSidebarSession,
  settleSidebarSessions,
  sidebarRowFor,
  sidebarSessionMutationKey,
} from "@/hooks/use-workspace-activity"
import { apiClient } from "@/lib/api-client"

export function agentSessionQueryOptions(sessionId: string) {
  return {
    queryKey: ["agent-session", sessionId] as const,
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].$get({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Session not found")
      return res.json()
    },
  }
}

export function useAgentSession(sessionId: string) {
  return useQuery(agentSessionQueryOptions(sessionId))
}

export type AgentSessionDetail = NonNullable<
  ReturnType<typeof useAgentSession>["data"]
>

function patchSessionCache(
  queryClient: QueryClient,
  sessionId: string,
  patch: Partial<RealtimeAgentSession>
) {
  queryClient.setQueryData<AgentSessionDetail>(
    agentSessionQueryOptions(sessionId).queryKey,
    (detail) =>
      detail ? { ...detail, session: { ...detail.session, ...patch } } : detail
  )
}

// Renames, generated titles and archives from anyone land live. The sidebar
// row takes the same event in the same tick, so a new title types out in the
// header and the sidebar together instead of waiting for the sidebar refetch.
export function useAgentSessionUpdates(sessionId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    const onUpdated = async ({ session }: AgentSessionUpdatedEvent) => {
      if (session.id !== sessionId) return
      await cancelSidebarFetch(queryClient, session.workspaceId)
      patchSidebarSession(
        queryClient,
        {
          workspaceId: session.workspaceId,
          channelId: session.channelId,
          sessionId,
        },
        session.archivedAt
          ? { hide: true }
          : {
              title: session.title,
              titleEdited: session.titleEditedAt !== null,
            }
      )
      patchSessionCache(queryClient, sessionId, session)
    }
    socket.on("session:updated", onUpdated)
    return () => {
      socket.off("session:updated", onUpdated)
    }
  }, [socket, queryClient, sessionId])
}

async function patchAgentSession(
  sessionId: string,
  body: { title?: string; archived?: boolean }
) {
  const res = await apiClient.v1.sessions[":sessionId"].$patch({
    param: { sessionId },
    json: body,
  })
  if (!res.ok) throw new Error("Couldn't update the session")
  return res.json()
}

type SessionChange = {
  workspaceId: string
  channelId: string
  sessionId: string
  title?: string
  archived?: boolean
}

// Rename, archive and unarchive show at once on the session page, in the
// sidebar and in the channel's Sessions list. A failure rolls the page back;
// the lists refetch. Archiving offers Undo, since the session leaves view.
export function useUpdateAgentSession() {
  const queryClient = useQueryClient()
  const { data: auth } = authClient.useSession()
  const currentUserId = auth?.user.id ?? null
  const mutation = useMutation({
    mutationKey: sidebarSessionMutationKey,
    mutationFn: ({ sessionId, title, archived }: SessionChange) =>
      patchAgentSession(sessionId, { title, archived }),
    onMutate: async (change) => {
      const { sessionId, workspaceId, channelId, title, archived } = change
      if (archived === true) {
        toast("Session archived", {
          action: {
            label: "Undo",
            onClick: () => mutation.mutate({ ...change, archived: false }),
          },
        })
      }
      const queryKey = agentSessionQueryOptions(sessionId).queryKey
      const listKey = channelSessionsKey(channelId)
      await Promise.all([
        queryClient.cancelQueries({ queryKey }),
        queryClient.cancelQueries({ queryKey: listKey }),
        cancelSidebarFetch(queryClient, workspaceId),
      ])
      const previous = queryClient.getQueryData<AgentSessionDetail>(queryKey)
      // Archive and unarchive move the row to the other filter's list.
      queryClient.setQueriesData<ChannelSession[]>(
        { queryKey: listKey },
        (rows) =>
          archived === undefined
            ? rows?.map((row) =>
                row.id === sessionId && title !== undefined
                  ? { ...row, title, titleEdited: true }
                  : row
              )
            : rows?.filter((row) => row.id !== sessionId)
      )
      if (title !== undefined) {
        patchSessionCache(queryClient, sessionId, {
          title,
          titleEditedAt: new Date().toISOString(),
        })
        patchSidebarSession(queryClient, change, { title, titleEdited: true })
      }
      if (archived === true) {
        patchSessionCache(queryClient, sessionId, {
          archivedAt: new Date().toISOString(),
          archivedById: currentUserId,
        })
        patchSidebarSession(queryClient, change, { hide: true })
      }
      if (archived === false) {
        patchSessionCache(queryClient, sessionId, {
          archivedAt: null,
          archivedById: null,
        })
        // Back in your sidebar only if you follow it.
        const session = previous?.session
        const subscribed = session
          ? queryClient
              .getQueryData<ThreadSubscriber[]>(
                threadSubscribersKey(session.threadRootId)
              )
              ?.some((person) => person.id === currentUserId)
          : false
        if (session && subscribed) {
          patchSidebarSession(queryClient, change, {
            show: sidebarRowFor(session),
          })
        }
      }
      return { previous }
    },
    onSuccess: ({ session }) =>
      patchSessionCache(queryClient, session.id, session),
    onError: (err, { sessionId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          agentSessionQueryOptions(sessionId).queryKey,
          context.previous
        )
      }
      toast.error(err.message)
    },
    onSettled: (_data, _err, { workspaceId, channelId }) => {
      settleSidebarSessions(queryClient, workspaceId)
      void queryClient.invalidateQueries({
        queryKey: channelSessionsKey(channelId),
      })
    },
  })
  return mutation
}
