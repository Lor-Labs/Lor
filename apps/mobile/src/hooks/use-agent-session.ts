import type {
  AgentSessionUpdatedEvent,
  RealtimeAgentSession,
} from "@repo/realtime-types"
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useToast } from "heroui-native/toast"
import { useEffect } from "react"
import { Alert } from "react-native"
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
  sidebarRowFor,
  sidebarSessionMutationKey,
  workspaceActivityKey,
} from "@/hooks/use-workspace-activity"
import { api } from "@/lib/api"
import type { AgentSession, AgentSessionDetail } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

// `pending`: seeded by a session start the server hasn't confirmed yet. The
// server's copy never has it.
export type SessionDetail = AgentSessionDetail & { pending?: boolean }

export function agentSessionKey(sessionId: string) {
  return ["agent-session", sessionId] as const
}

export function agentSessionQueryOptions(sessionId: string) {
  return {
    queryKey: agentSessionKey(sessionId),
    queryFn: async (): Promise<SessionDetail> => {
      const response = await api.v1.sessions[":sessionId"].$get({
        param: { sessionId },
      })
      if (!response.ok) throw new Error("Could not load this session")
      return response.json()
    },
  }
}

export function useAgentSession(sessionId: string) {
  return useQuery({
    ...agentSessionQueryOptions(sessionId),
    enabled: Boolean(sessionId),
  })
}

// The sidebar row and the session's cache take the same event in the same
// tick, so a new title types out in the heading and the Channels tab
// together instead of waiting for the sidebar refetch.
async function applySessionUpdate(
  queryClient: QueryClient,
  session: RealtimeAgentSession
) {
  await cancelSidebarFetch(queryClient, session.workspaceId)
  patchSidebarSession(
    queryClient,
    {
      workspaceId: session.workspaceId,
      channelId: session.channelId,
      sessionId: session.id,
    },
    session.archivedAt
      ? { hide: true }
      : { title: session.title, titleEdited: session.titleEditedAt !== null }
  )
  queryClient.setQueryData<SessionDetail>(
    agentSessionKey(session.id),
    (detail) => (detail ? { ...detail, session } : detail)
  )
}

// Generated titles, renames and archives from anyone land live on the open
// session (the channel room carries them).
export function useAgentSessionUpdates(sessionId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    const onUpdated = ({ session }: AgentSessionUpdatedEvent) => {
      if (session.id === sessionId) {
        void applySessionUpdate(queryClient, session)
      }
    }
    socket.on("session:updated", onUpdated)
    return () => {
      socket.off("session:updated", onUpdated)
    }
  }, [socket, queryClient, sessionId])
}

function patchSessionCache(
  queryClient: QueryClient,
  sessionId: string,
  patch: Partial<AgentSession>
) {
  queryClient.setQueryData<SessionDetail>(
    agentSessionKey(sessionId),
    (detail) =>
      detail ? { ...detail, session: { ...detail.session, ...patch } } : detail
  )
}

type SessionChange = {
  workspaceId: string
  channelId: string
  sessionId: string
  title?: string
  archived?: boolean
}

// Rename, archive and unarchive show at once on the session screen, in the
// Channels tab and in the channel's Sessions list. A failure rolls the
// screen back; the lists refetch. Archiving offers Undo, since the session
// leaves view. Mirrors web's useUpdateAgentSession.
export function useUpdateAgentSession() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: auth } = authClient.useSession()
  const currentUserId = auth?.user.id ?? null
  const mutation = useMutation({
    mutationKey: sidebarSessionMutationKey,
    mutationFn: async ({ sessionId, title, archived }: SessionChange) => {
      const res = await api.v1.sessions[":sessionId"].$patch({
        param: { sessionId },
        json: { title, archived },
      })
      if (!res.ok) throw new Error("Couldn't update the session")
      return res.json()
    },
    onMutate: async (change) => {
      const { sessionId, workspaceId, channelId, title, archived } = change
      if (archived === true) {
        toast.show({
          label: "Session archived",
          actionLabel: "Undo",
          onActionPress: ({ hide }) => {
            hide("all")
            mutation.mutate({ ...change, archived: false })
          },
        })
      }
      const queryKey = agentSessionKey(sessionId)
      const listKey = channelSessionsKey(channelId)
      await Promise.all([
        queryClient.cancelQueries({ queryKey }),
        queryClient.cancelQueries({ queryKey: listKey }),
        cancelSidebarFetch(queryClient, workspaceId),
      ])
      const previous = queryClient.getQueryData<SessionDetail>(queryKey)
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
        // Back in the Channels tab only if you follow it.
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
    onError: (error, { sessionId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(agentSessionKey(sessionId), context.previous)
      }
      Alert.alert(error.message, "Please try again in a moment.")
    },
    onSettled: (_data, _error, { workspaceId, channelId }) => {
      // The last change in flight refetches the truth, which also undoes a
      // failed one.
      if (
        queryClient.isMutating({ mutationKey: sidebarSessionMutationKey }) <= 1
      ) {
        void queryClient.invalidateQueries({
          queryKey: workspaceActivityKey(workspaceId),
        })
      }
      void queryClient.invalidateQueries({
        queryKey: channelSessionsKey(channelId),
      })
    },
  })
  return mutation
}

// Every session the user follows, wherever they are: generated titles also
// reach each subscriber's user room, so they type out in the Channels tab
// even when the session isn't open.
export function useWorkspaceSessionUpdates(workspaceId: string | undefined) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket || !workspaceId) return
    const onUpdated = ({ session }: AgentSessionUpdatedEvent) => {
      if (session.workspaceId === workspaceId) {
        void applySessionUpdate(queryClient, session)
      }
    }
    socket.on("session:updated", onUpdated)
    return () => {
      socket.off("session:updated", onUpdated)
    }
  }, [socket, queryClient, workspaceId])
}
