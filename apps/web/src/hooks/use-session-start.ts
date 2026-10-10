import { authClient } from "@repo/auth/client"
import type { RealtimeAgentSession } from "@repo/realtime-types"
import { toast } from "@repo/ui/components/toast"
import { type InfiniteData, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { useRef } from "react"
import { useSessionStartedNote } from "@/components/session/session-started-note"
import {
  type AgentSessionDetail,
  agentSessionQueryOptions,
} from "@/hooks/use-agent-session"
import type { ThreadPage, ThreadPageParam } from "@/hooks/use-thread-messages"
import {
  type ThreadSubscriber,
  threadSubscribersKey,
} from "@/hooks/use-thread-subscribers"
import {
  cancelSidebarFetch,
  patchSidebarSession,
  sidebarRowFor,
} from "@/hooks/use-workspace-activity"
import type { Message } from "@/lib/api-types"

// The seeded caches count as fresh this long, so the session page doesn't
// fetch rows the server hasn't inserted yet; the ack refetches them sooner.
const PENDING_MS = 10_000

export type SessionStart = {
  id: string
  threadRootId: string
  origin: "chat" | "new"
  title: string
  // The sender's message, the session's first turn.
  message: Message
  // Cmd+Enter: start it without opening it.
  stay: boolean
}

export type SessionStartHandlers = {
  starting: (start: SessionStart) => void
  started: (start: SessionStart, session: RealtimeAgentSession) => void
  failed: (start: SessionStart) => void
}

// @Lor in chat or a human thread, or the New session view, starts a session
// optimistically: its page, sidebar row and first turn exist before the
// server confirms, under ids the client chose. Enter opens it at once;
// Cmd+Enter keeps you where you are, so several can start in a row.
export function useSessionStart({
  workspaceSlug,
  channel,
}: {
  workspaceSlug: string
  channel: { id: string; name: string | null }
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const { data: auth } = authClient.useSession()
  const note = useSessionStartedNote()
  // Starts shown before the ack; the rest open once it arrives.
  const optimistic = useRef(new Set<string>())

  const workspaceId = () =>
    queryClient
      .getQueryData<Array<{ id: string; slug: string }>>(["workspaces"])
      ?.find((workspace) => workspace.slug === workspaceSlug)?.id
  const sidebarTarget = (session: RealtimeAgentSession) => ({
    workspaceId: session.workspaceId,
    channelId: session.channelId,
    sessionId: session.id,
  })
  const reveal = (session: RealtimeAgentSession, stay: boolean) => {
    if (stay) note.onSessionStarted(session)
    else
      void navigate({
        to: "/$workspaceSlug/session/$sessionId",
        params: { workspaceSlug, sessionId: session.id },
      })
  }

  const starting = (start: SessionStart) => {
    const wsId = workspaceId()
    const user = auth?.user
    if (!wsId || !user) return
    optimistic.current.add(start.id)
    const now = new Date().toISOString()
    const session: RealtimeAgentSession = {
      id: start.id,
      workspaceId: wsId,
      channelId: channel.id,
      threadRootId: start.threadRootId,
      creatorId: user.id,
      origin: start.origin,
      title: start.title,
      titleEditedAt: null,
      loopId: null,
      triggerId: null,
      archivedAt: null,
      archivedById: null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    }
    const updatedAt = Date.now() + PENDING_MS
    queryClient.setQueryData<AgentSessionDetail>(
      agentSessionQueryOptions(start.id).queryKey,
      { session, channel, context: [] },
      { updatedAt }
    )
    queryClient.setQueryData<InfiniteData<ThreadPage, ThreadPageParam>>(
      ["thread", start.threadRootId],
      {
        pages: [
          {
            data: [start.message],
            beforeCursor: null,
            afterCursor: null,
            reachedOldest: true,
            reachedNewest: true,
            root: null,
            participants: [],
          },
        ],
        pageParams: [null],
      },
      { updatedAt }
    )
    queryClient.setQueryData<ThreadSubscriber[]>(
      threadSubscribersKey(start.threadRootId),
      [
        {
          id: user.id,
          name: user.name,
          image: user.image ?? null,
          avatarColor: null,
        },
      ],
      { updatedAt }
    )
    void cancelSidebarFetch(queryClient, wsId).then(() =>
      patchSidebarSession(queryClient, sidebarTarget(session), {
        show: { ...sidebarRowFor(session), state: "running" },
      })
    )
    reveal(session, start.stay)
  }

  const started = (start: SessionStart, session: RealtimeAgentSession) => {
    if (!optimistic.current.delete(start.id)) {
      reveal(session, start.stay)
      return
    }
    for (const queryKey of [
      agentSessionQueryOptions(session.id).queryKey,
      ["thread", session.threadRootId],
      threadSubscribersKey(session.threadRootId),
    ]) {
      void queryClient.invalidateQueries({ queryKey })
    }
    // No sidebar refetch here: Lor's run row commits after the ack, and the
    // server pushes the sidebar then. Refetching now would flash the row idle.
  }

  const failed = (start: SessionStart) => {
    toast.error("Couldn't start the session")
    const wsId = workspaceId()
    if (!optimistic.current.delete(start.id) || !wsId) return
    for (const queryKey of [
      agentSessionQueryOptions(start.id).queryKey,
      ["thread", start.threadRootId],
      threadSubscribersKey(start.threadRootId),
    ]) {
      queryClient.removeQueries({ queryKey, exact: true })
    }
    patchSidebarSession(
      queryClient,
      { workspaceId: wsId, channelId: channel.id, sessionId: start.id },
      { hide: true }
    )
    if (router.state.location.pathname.endsWith(`/session/${start.id}`)) {
      void navigate({
        to: "/$workspaceSlug/$channelId",
        params: { workspaceSlug, channelId: channel.id },
      })
    }
  }

  const handlers: SessionStartHandlers = { starting, started, failed }
  return { handlers, started: note.started }
}
