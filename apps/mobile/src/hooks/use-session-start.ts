import type { RealtimeAgentSession } from "@repo/realtime-types"
import { useQueryClient } from "@tanstack/react-query"
import { randomUUID } from "expo-crypto"
import { router } from "expo-router"
import { useRef } from "react"
import { useWorkspace } from "@/context/workspace-context"
import { agentSessionKey, type SessionDetail } from "@/hooks/use-agent-session"
import type { ThreadSnapshot } from "@/hooks/use-thread-messages"
import type { Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { replaceMessage } from "@/lib/messages"

// The seeded session counts as fresh this long, so its screen doesn't fetch a
// row the server hasn't inserted yet; the ack refetches it sooner.
const PENDING_MS = 10_000

export type SessionStart = {
  id: string
  threadRootId: string
  title: string
  // The sender's message, the session's first turn.
  message: Message
}

export type SessionStartHandlers = {
  starting: (start: SessionStart) => void
  // `message`: the server's copy of the first turn.
  started: (
    start: SessionStart,
    session: RealtimeAgentSession,
    message: Message
  ) => void
  failed: (start: SessionStart) => void
}

// The client picks a new session's ids, so it can show the session before
// the ack; the server inserts the rows under them.
export function newSessionIds() {
  return { id: randomUUID(), threadRootId: randomUUID() }
}

function openSession(sessionId: string) {
  router.push({ pathname: "/session/[sessionId]", params: { sessionId } })
}

// @Lor in chat or a human thread starts a session optimistically: its screen
// and first turn exist before the server confirms, and it opens at once.
// Mirrors web's use-session-start.ts.
export function useSessionStart(channel: { id: string; name: string | null }) {
  const queryClient = useQueryClient()
  const { workspace } = useWorkspace()
  const { data: auth } = authClient.useSession()
  // Starts shown before the ack; the rest open once it arrives.
  const optimistic = useRef(new Set<string>())

  const starting = (start: SessionStart) => {
    const user = auth?.user
    if (!workspace || !user) return
    optimistic.current.add(start.id)
    const now = new Date().toISOString()
    queryClient.setQueryData<SessionDetail>(
      agentSessionKey(start.id),
      {
        session: {
          id: start.id,
          workspaceId: workspace.id,
          channelId: channel.id,
          threadRootId: start.threadRootId,
          creatorId: user.id,
          origin: "chat",
          title: start.title,
          titleEditedAt: null,
          loopId: null,
          triggerId: null,
          archivedAt: null,
          archivedById: null,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        },
        channel,
        context: [],
        pending: true,
      },
      { updatedAt: Date.now() + PENDING_MS }
    )
    queryClient.setQueryData<ThreadSnapshot>(["thread", start.threadRootId], {
      messages: [start.message],
      root: null,
      participants: [
        {
          id: user.id,
          name: user.name,
          image: user.image ?? null,
          avatarColor: null,
        },
      ],
      totalReplyCount: 1,
      beforeCursor: null,
      reachedOldest: true,
      voiceSessionId: null,
      voiceSessionTitle: null,
    })
    openSession(start.id)
  }

  const started = (
    start: SessionStart,
    session: RealtimeAgentSession,
    message: Message
  ) => {
    if (!optimistic.current.delete(start.id)) {
      openSession(session.id)
      return
    }
    // A reload keeps unacked `mobile-` sends, so swap in the server's copy
    // first or the first turn shows twice.
    queryClient.setQueryData<ThreadSnapshot>(
      ["thread", session.threadRootId],
      (snapshot) =>
        snapshot && {
          ...snapshot,
          messages: replaceMessage(
            snapshot.messages,
            start.message.id,
            message
          ),
        }
    )
    // The server's copy drops `pending`, so the screen loads the transcript.
    void queryClient.invalidateQueries({
      queryKey: agentSessionKey(session.id),
    })
  }

  const failed = (start: SessionStart) => {
    if (!optimistic.current.delete(start.id)) return
    queryClient.removeQueries({
      queryKey: ["thread", start.threadRootId],
      exact: true,
    })
    // An open session screen refetches: it shows the session if the start
    // landed despite a lost ack, and "unavailable" if it didn't.
    void queryClient.resetQueries({
      queryKey: agentSessionKey(start.id),
      exact: true,
    })
  }

  const handlers: SessionStartHandlers = { starting, started, failed }
  return handlers
}
