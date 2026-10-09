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
  type ThreadSubscriber,
  threadSubscribersKey,
} from "@/hooks/use-thread-subscribers"
import { apiClient } from "@/lib/api-client"
import { setSessionOverlay, sidebarRowFor } from "@/lib/sidebar-session-overlay"

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

// Renames and archives from anyone (title, archive notice) land live.
export function useAgentSessionUpdates(sessionId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    const onUpdated = ({ session }: AgentSessionUpdatedEvent) => {
      if (session.id === sessionId) {
        patchSessionCache(queryClient, sessionId, session)
      }
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
  sessionId: string
  channelId: string
  title?: string
  archived?: boolean
}

// Rename, archive and unarchive show at once on the session page and in the
// sidebar, and roll back if the request fails.
export function useUpdateAgentSession() {
  const queryClient = useQueryClient()
  const { data: auth } = authClient.useSession()
  const currentUserId = auth?.user.id ?? null
  return useMutation({
    mutationFn: ({ sessionId, title, archived }: SessionChange) =>
      patchAgentSession(sessionId, { title, archived }),
    onMutate: async ({ sessionId, channelId, title, archived }) => {
      const queryKey = agentSessionQueryOptions(sessionId).queryKey
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<AgentSessionDetail>(queryKey)
      if (title !== undefined) {
        patchSessionCache(queryClient, sessionId, { title })
        setSessionOverlay(sessionId, { kind: "rename", channelId, title })
      }
      if (archived === true) {
        patchSessionCache(queryClient, sessionId, {
          archivedAt: new Date().toISOString(),
          archivedById: currentUserId,
        })
        setSessionOverlay(sessionId, { kind: "hide", channelId })
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
        setSessionOverlay(
          sessionId,
          session && subscribed
            ? { kind: "show", channelId, row: sidebarRowFor(session) }
            : null
        )
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
      setSessionOverlay(sessionId, null)
      toast.error(err.message)
    },
  })
}
