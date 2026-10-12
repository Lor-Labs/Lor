import type {
  AgentSessionUpdatedEvent,
  RealtimeAgentSession,
} from "@repo/realtime-types"
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import {
  cancelSidebarFetch,
  patchSidebarSession,
} from "@/hooks/use-workspace-activity"
import { api } from "@/lib/api"
import type { AgentSessionDetail } from "@/lib/api-types"

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
