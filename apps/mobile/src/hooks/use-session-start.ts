import {
  type RealtimeAgentSession,
  type SendMessagePayload,
  sessionTitleFromPrompt,
} from "@repo/realtime-types"
import { useQueryClient } from "@tanstack/react-query"
import { randomUUID } from "expo-crypto"
import { router } from "expo-router"
import { useRef } from "react"
import { useSocket } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { agentSessionKey, type SessionDetail } from "@/hooks/use-agent-session"
import type { ThreadSnapshot } from "@/hooks/use-thread-messages"
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
import { authClient } from "@/lib/auth-client"
import type { SessionHarness } from "@/lib/harness"
import { lorMention, mentionsLor } from "@/lib/mentions"
import {
  createOptimisticMessage,
  realtimeMessageToMessage,
  replaceMessage,
} from "@/lib/messages"

// The seeded session counts as fresh this long, so its screen doesn't fetch a
// row the server hasn't inserted yet; the ack refetches it sooner.
const PENDING_MS = 10_000

export type SessionStart = {
  id: string
  threadRootId: string
  // "new": the New session screen; "chat": @Lor in chat or a thread.
  origin: "chat" | "new"
  title: string
  // The sender's message, the session's first turn.
  message: Message
  // A code session: its repo, base branch and agent.
  // `newBranch`: made from `branch` at the start.
  code?: {
    repo: string
    branch: string
    newBranch?: string
    harness: SessionHarness
  }
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

function openSession(sessionId: string, replace: boolean) {
  const href = {
    pathname: "/session/[sessionId]",
    params: { sessionId },
  } as const
  if (replace) router.replace(href)
  else router.push(href)
}

// @Lor in chat or a human thread starts a session optimistically: its screen
// and first turn exist before the server confirms, and it opens at once.
// Mirrors web's use-session-start.ts.
export function useSessionStart(
  channel: { id: string; name: string | null },
  // The New session screen gives its place to the session.
  { replace = false }: { replace?: boolean } = {}
) {
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
    const session: RealtimeAgentSession = {
      id: start.id,
      workspaceId: workspace.id,
      channelId: channel.id,
      threadRootId: start.threadRootId,
      creatorId: user.id,
      origin: start.origin,
      mode: start.code ? "code" : "chat",
      harness: start.code?.harness ?? "pi",
      repoFullName: start.code?.repo ?? null,
      baseBranch: start.code?.branch ?? null,
      newBranch: start.code?.newBranch ?? null,
      environmentId: null,
      uncommittedAdditions: null,
      uncommittedDeletions: null,
      sourceSessionId: null,
      forkedFromMessageId: null,
      title: start.title,
      titleEditedAt: null,
      loopId: null,
      triggerId: null,
      triggerSubject: null,
      archivedAt: null,
      archivedById: null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    }
    queryClient.setQueryData<SessionDetail>(
      agentSessionKey(start.id),
      { session, channel, context: [], source: null, pending: true },
      { updatedAt: Date.now() + PENDING_MS }
    )
    // No refetch when it's confirmed: Lor's run row commits after the ack,
    // and the server pushes the sidebar then.
    void cancelSidebarFetch(queryClient, workspace.id).then(() =>
      patchSidebarSession(
        queryClient,
        {
          workspaceId: workspace.id,
          channelId: channel.id,
          sessionId: start.id,
        },
        { show: { ...sidebarRowFor(session), state: "running" } }
      )
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
      voiceSessionEnded: false,
    })
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
      { updatedAt: Date.now() + PENDING_MS }
    )
    openSession(start.id, replace)
  }

  const started = (
    start: SessionStart,
    session: RealtimeAgentSession,
    message: Message
  ) => {
    if (!optimistic.current.delete(start.id)) {
      openSession(session.id, replace)
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
    // Mentioned people are subscribed too.
    void queryClient.invalidateQueries({
      queryKey: threadSubscribersKey(session.threadRootId),
    })
  }

  const failed = (start: SessionStart) => {
    if (!optimistic.current.delete(start.id)) return
    if (workspace) {
      patchSidebarSession(
        queryClient,
        {
          workspaceId: workspace.id,
          channelId: channel.id,
          sessionId: start.id,
        },
        { hide: true }
      )
    }
    for (const queryKey of [
      ["thread", start.threadRootId],
      threadSubscribersKey(start.threadRootId),
    ]) {
      queryClient.removeQueries({ queryKey, exact: true })
    }
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

// The New session screen: the message starts a session in `channel` with no
// chat context, @Lor or not. "Ask Lor about this" passes the asked-about
// message as its only context.
export function useSendNewSession(channel: {
  id: string
  name: string | null
}) {
  const socket = useSocket()
  const { data: auth } = authClient.useSession()
  const handlers = useSessionStart(channel, { replace: true })

  return async (
    content: string,
    attachments: NonNullable<Message["attachments"]>,
    contextMessageId: string | undefined,
    // Code mode: the session's repo, base branch (or a new branch from it)
    // and agent.
    code?: SessionStart["code"],
    // The model, effort and fast mode for its first turn.
    turn?: Pick<SendMessagePayload, "model" | "effort" | "fast">
  ) => {
    const user = auth?.user
    if (!socket?.connected) {
      throw new Error("You're offline. Reconnect and try again.")
    }
    if (!user) {
      throw new Error("Your session is unavailable. Please sign in again.")
    }
    const nonce = `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const ids = newSessionIds()
    const start: SessionStart = {
      ...ids,
      origin: "new",
      title: sessionTitleFromPrompt(content),
      message: {
        ...createOptimisticMessage({
          nonce,
          channelId: channel.id,
          content: content || null,
          author: user,
          attachments,
          threadRootId: ids.threadRootId,
        }),
        mentions: mentionsLor(content) ? [lorMention] : [],
      },
      ...(code ? { code } : {}),
    }
    handlers.starting(start)
    try {
      const result = await socket.timeout(12_000).emitWithAck("message:send", {
        channelId: channel.id,
        content: content || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        nonce,
        startSession: true,
        newSession: ids,
        referencedMessageId: contextMessageId,
        ...(code
          ? {
              code: {
                repo: code.repo,
                branch: code.branch,
                ...(code.newBranch ? { newBranch: code.newBranch } : {}),
              },
              harness: code.harness,
            }
          : {}),
        ...turn,
      })
      if (!result.ok) throw new Error(result.error)
      if (!result.session) throw new Error("Couldn't start the session")
      handlers.started(
        start,
        result.session,
        realtimeMessageToMessage(result.message)
      )
    } catch (cause) {
      handlers.failed(start)
      throw cause instanceof Error &&
        cause.message === "operation has timed out"
        ? new Error("Starting the session timed out. Please try again.")
        : cause
    }
  }
}
