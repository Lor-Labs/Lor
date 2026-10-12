import {
  Copy01Icon,
  CornerUpRightIcon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { LOR_USER_ID } from "@repo/db/constants"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@repo/ui/components/message-scroller"
import { Skeleton } from "@repo/ui/components/skeleton"
import { Spinner } from "@repo/ui/components/spinner"
import { Tabs, TabsList, TabsTab } from "@repo/ui/components/tabs"
import { anchoredToastManager, toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import {
  differenceInMinutes,
  formatDateTime,
  isSameDay,
} from "@repo/utils/date"
import {
  type InfiniteData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useDropzone } from "react-dropzone"
import { ChannelEventRow } from "@/components/chat/channel-event-row"
import { MessageInput } from "@/components/chat/composer/message-input"
import { DropZoneOverlay } from "@/components/chat/drop-zone-overlay"
import { ForwardDialog } from "@/components/chat/forward-dialog"
import { MessageItem } from "@/components/chat/message-item"
import { scrollToMessage } from "@/components/chat/message-list"
import {
  highlightMessage,
  jumpScrollBehavior,
  MessageScrollerCommandBridge,
  MessageScrollerJumpToLatest,
  signalMessageScrollerInteraction,
  useRegisteredMessageScroller,
} from "@/components/chat/message-scroller-controls"
import { RunQueuePill } from "@/components/chat/run-queue-pill"
import { ThreadSubscribers } from "@/components/chat/thread-subscribers"
import {
  type PlanSourceFile,
  ThreadWorkHeader,
} from "@/components/chat/thread-work-header"
import {
  DocumentTypingIndicator,
  TypingIndicator,
} from "@/components/chat/typing-indicator"
import { SessionStartedNote } from "@/components/session/session-started-note"
import { SessionTurnRail } from "@/components/session/session-turn-rail"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type {
  CallTab,
  ThreadSidebarView,
} from "@/components/sidebar/right-panel/right-sidebar-types"
import { MorphText } from "@/components/ui/morph-text"
import { UserAvatar } from "@/components/ui/user-avatar"
import { CallSummaryPanel } from "@/components/voice/call-summary"
import { CallTranscript } from "@/components/voice/call-transcript"
import { useSocket } from "@/context/socket-context"
import { useVoiceCall } from "@/context/voice-call-context"
import { cachedSessionForThread } from "@/hooks/use-agent-session"
import { useCallSummary } from "@/hooks/use-call-summary"
import { usePlanForThread } from "@/hooks/use-channel-plans"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useLorRunReplay } from "@/hooks/use-lor-stream"
import { useMarkThreadRead } from "@/hooks/use-mark-thread-read"
import {
  useChannelPeople,
  useMentionCandidates,
} from "@/hooks/use-mention-candidates"
import { useMessageDeletion } from "@/hooks/use-message-deletion"
import { useMessageEditing } from "@/hooks/use-message-editing"
import { useMessageReactions } from "@/hooks/use-message-reactions"
import {
  useMessageLocation,
  useMessageSearchNavigation,
} from "@/hooks/use-message-search-navigation"
import { useMessageSending } from "@/hooks/use-message-sending"
import { usePlanArtifacts } from "@/hooks/use-plan"
import { useQueuedMessageSteering } from "@/hooks/use-queued-message-steering"
import { useReplyState } from "@/hooks/use-reply-state"
import { useRunQueue } from "@/hooks/use-run-queue"
import { useSessionStart } from "@/hooks/use-session-start"
import { useStopLorRun } from "@/hooks/use-stop-lor-run"
import {
  dropOptimisticLorTurns,
  type FetchPageParams,
  fetchThreadPage,
  isOptimisticLorTurn,
  showOptimisticLorTurn,
  useThreadMessages,
} from "@/hooks/use-thread-messages"
import {
  showWriteSubscribers,
  type ThreadSubscriber,
  threadSubscribersKey,
  threadSubscribersQueryOptions,
} from "@/hooks/use-thread-subscribers"
import { useTypingIndicator } from "@/hooks/use-typing-indicator"
import {
  cancelSidebarFetch,
  patchSidebarSession,
  settleSidebarSessions,
  sidebarRowFor,
} from "@/hooks/use-workspace-activity"
import type { Message } from "@/lib/api-types"
import { channelQueryOptions } from "@/lib/channel-query"
import { PLAN_STATUS_META } from "@/lib/plan-ui"

const MESSAGE_GROUP_WINDOW_MINUTES = 5
// How long a local Lor turn waits for the server's before it goes.
const LOR_TURN_TIMEOUT_MS = 20_000

const THREAD_SKELETON_GROUPS = [
  { key: "a", nameWidth: "4.5rem", lines: ["75%", "40%"] },
  { key: "b", nameWidth: "6rem", lines: ["55%"] },
  { key: "c", nameWidth: "4rem", lines: ["85%", "30%"] },
  { key: "d", nameWidth: "5.5rem", lines: ["50%"] },
]

type ChannelMessagesCache = InfiniteData<{ data: Message[] }> | undefined

function findMessageInChannelCache(
  cache: ChannelMessagesCache,
  messageId: string
): Message | null {
  if (!cache) return null
  for (const page of cache.pages) {
    const found = page.data.find((m) => m.id === messageId)
    if (found) return found
  }
  return null
}

function messageAuthor(message: Message): string {
  return message.overrideName ?? message.author.name
}

function messageToMarkdown(message: Message, headingLevel: 2 | 3): string {
  const heading = "#".repeat(headingLevel)
  const lines = [
    `${heading} ${messageAuthor(message)} — ${formatDateTime(message.createdAt)}`,
    "",
    message.content?.trim() || "_No text content._",
  ]
  const attachments = message.attachments ?? []
  if (attachments.length > 0) {
    lines.push("", "Attachments:")
    for (const attachment of attachments) {
      lines.push(
        `- [${attachment.filename}](${attachment.url}) (${attachment.contentType})`
      )
    }
  }
  return lines.join("\n")
}

// A Lor session renders this same conversation in the main area, with its own
// header and no thread root. Its context, plan, files and activity live in
// the right panel instead of the docked work header.
export type SessionPresentation = {
  // headingVisible: the header shows the title once the heading is gone.
  header: (state: { lorRunning: boolean; headingVisible: boolean }) => ReactNode
  // Opens the document (title and context line); shows once the oldest page
  // is loaded, so it scrolls with the transcript.
  heading?: ReactNode
  // An archived session is read-only: this replaces its input line and tools.
  archivedBar?: ReactNode
}

export function ThreadPanel({
  view,
  sessionView,
}: {
  view: ThreadSidebarView
  sessionView?: SessionPresentation
}) {
  const { consumeComposerDraft, setView } = useRightSidebar()
  const { call } = useVoiceCall()
  const queryClient = useQueryClient()
  const socket = useSocket()
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user.id

  const navigate = useNavigate()
  const { resolve: resolveMessageLocation } = useMessageLocation()
  const navigateToMessage = useMessageSearchNavigation()
  const actionsMenuTriggerRef = useRef<HTMLButtonElement>(null)

  // Jump the main channel feed to the thread root. Scroll in place if it's
  // already rendered; otherwise anchor the feed on it via ?msgId (the channel
  // refetches around it). Leaves the thread open so both stay in view.
  const handleViewInChannel = useCallback(() => {
    if (scrollToMessage(view.threadRootId)) return
    void navigate({
      to: "/$workspaceSlug/$channelId",
      params: {
        workspaceSlug: view.workspaceSlug,
        channelId: view.channelId,
      },
      search: (prev) => ({ ...prev, msgId: view.threadRootId }),
    })
  }, [navigate, view.workspaceSlug, view.channelId, view.threadRootId])

  // Subscribe to the channel cache so the root reflects edits, reactions,
  // and embed unfurls while the thread panel is open. The channel feed hook
  // (in the main view) owns the actual fetch — we just read here.
  const subscribeToChannelCache = useCallback(
    (onChange: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey
        if (key[0] === "messages" && key[1] === view.channelId) onChange()
      }),
    [queryClient, view.channelId]
  )
  const getChannelRoot = useCallback(
    () =>
      findMessageInChannelCache(
        queryClient.getQueryData<ChannelMessagesCache>([
          "messages",
          view.channelId,
        ]),
        view.threadRootId
      ),
    [queryClient, view.channelId, view.threadRootId]
  )
  const channelCacheRoot = useSyncExternalStore(
    subscribeToChannelCache,
    getChannelRoot,
    getChannelRoot
  )

  const fetchPage = useCallback(
    (params: FetchPageParams) =>
      fetchThreadPage(
        {
          workspaceSlug: view.workspaceSlug,
          channelId: view.channelId,
          threadRootId: view.threadRootId,
        },
        params
      ),
    [view.workspaceSlug, view.channelId, view.threadRootId]
  )

  // Latest-ref indirection: useRunQueue mounts below (it needs the thread
  // messages), but a failed send must drop the nonce it mirrored there.
  const removeQueuedOptimisticRef = useRef<(id: string) => void>(() => {})
  const undoSendRef = useRef<(nonce: string) => void>(() => {})
  const { data: channel } = useQuery(
    channelQueryOptions(view.workspaceSlug, view.channelId)
  )
  // Session: the message being forwarded into the channel chat.
  const [forwarding, setForwarding] = useState<Message | null>(null)
  // @Lor in a human thread starts a session seeded with the thread.
  const sessionStart = useSessionStart({
    workspaceSlug: view.workspaceSlug,
    channel: { id: view.channelId, name: channel?.name ?? null },
  })
  const { handleSend, pendingNonces } = useMessageSending({
    socket,
    queryClient,
    channelId: view.channelId,
    currentUser: session?.user,
    threadRootId: view.threadRootId,
    onSendFailed: (nonce) => {
      removeQueuedOptimisticRef.current(nonce)
      undoSendRef.current(nonce)
    },
    sessionStart:
      !sessionView && channel?.type === "text"
        ? sessionStart.handlers
        : undefined,
  })

  const {
    messages,
    root: threadApiRoot,
    participants,
    voiceSessionId,
    voiceSessionTitle,
    voiceSessionEnded,
    isLoading,
    fetchOlder,
    hasOlder,
    isFetchingOlder,
    ensureMessage,
  } = useThreadMessages({
    channelId: view.channelId,
    threadRootId: view.threadRootId,
    fetchPage,
    socket,
    pendingNoncesRef: pendingNonces,
  })

  const rootMessage = threadApiRoot ?? channelCacheRoot
  // A call chat's panel also holds the call's record: its summary (once the
  // call has ended, and then the default) and its transcript.
  const callTab: CallTab =
    voiceSessionId === null
      ? "chat"
      : view.callTab === "summary" && !voiceSessionEnded
        ? "chat"
        : (view.callTab ?? (voiceSessionEnded ? "summary" : "chat"))
  const showTranscript = callTab === "transcript"
  const showSummary = callTab === "summary"
  const callSummary = useCallSummary(voiceSessionEnded ? voiceSessionId : null)
  const callTitle =
    callSummary.data?.summary?.title ?? voiceSessionTitle ?? "Call"

  // An open panel means the thread is being read — advance the per-thread
  // read cursor on open and on every reply that lands while it's visible, so
  // the activity dock stays clear here and on other devices.
  const markThreadRead = useMarkThreadRead(view.workspaceSlug, view.channelId)
  // Status too: a Lor reply finishing while open must count as read, or the
  // session's sidebar row shows unread for a reply already seen.
  const newestReplyKey = messages[0]
    ? `${messages[0].id}:${messages[0].status}`
    : null
  const showCallRecord = callTab !== "chat"
  useEffect(() => {
    if (document.visibilityState !== "visible" || showCallRecord) return
    const timer = setTimeout(() => markThreadRead(view.threadRootId), 500)
    return () => clearTimeout(timer)
  }, [view.threadRootId, newestReplyKey, markThreadRead, showCallRecord])
  useEffect(() => {
    if (showCallRecord) return
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        markThreadRead(view.threadRootId)
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [view.threadRootId, markThreadRead, showCallRecord])

  // MessageItem is memoized — keep the root message prop referentially
  // stable. A fresh `{ ...rootMessage, threadSummary: null }` spread on every
  // render would defeat the memo and re-render the row on any panel render.
  const rootMessageForRender = useMemo(
    () => (rootMessage ? { ...rootMessage, threadSummary: null } : null),
    [rootMessage]
  )

  // Plan threads get their own panel identity: header says Plan + live
  // status, and the docked strip below carries plan/files/approval. A thread
  // is a plan thread iff a plan row anchors to its root — the root message
  // type no longer decides (any thread can become a plan mid-conversation).
  const plan = usePlanForThread(view.channelId, view.threadRootId)
  const isPlan = !!plan
  const planStatusMeta = plan ? PLAN_STATUS_META[plan.status] : null
  const { data: planArtifacts } = usePlanArtifacts(plan?.id ?? null)
  // Newest Lor reply with tool calls — the Activity chip's work log. Shown
  // for any thread where Lor worked, plan or not.
  const activityMessage = useMemo(
    () =>
      messages.find(
        (message) =>
          message.authorId === LOR_USER_ID &&
          (message.lorToolCalls?.length ?? 0) > 0
      ) ?? null,
    [messages]
  )
  const showWorkHeader = !sessionView && (isPlan || activityMessage !== null)

  const handleCopyAsMarkdown = useCallback(async () => {
    try {
      const firstPage = await fetchPage({ limit: 50 })
      const replies = new Map<string, Message>()
      for (const message of [...messages, ...firstPage.data]) {
        if (message.status !== "pending") replies.set(message.id, message)
      }

      let page = firstPage
      const visitedCursors = new Set<string>()
      while (!page.reachedOldest && page.beforeCursor) {
        if (visitedCursors.has(page.beforeCursor)) break
        visitedCursors.add(page.beforeCursor)
        page = await fetchPage({ before: page.beforeCursor, limit: 50 })
        for (const message of page.data) {
          if (message.status !== "pending") replies.set(message.id, message)
        }
      }

      const root = rootMessage ?? firstPage.root ?? null
      const orderedMessages = [...replies.values()].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          a.id.localeCompare(b.id)
      )
      const sections: string[] = []

      if (isPlan && plan) {
        sections.push(`# ${plan.title}`, "", plan.goal)
        sections.push(
          "",
          `**Status:** ${PLAN_STATUS_META[plan.status].label}`,
          `**Created:** ${formatDateTime(plan.createdAt)}`
        )
        if (plan.steps.length > 0) {
          sections.push("", "## Steps", "")
          for (const item of plan.steps) {
            const marker = item.status === "done" ? "x" : " "
            const active = item.status === "active" ? " _(in progress)_" : ""
            sections.push(`- [${marker}] ${item.text}${active}`)
            if (item.description) sections.push(`  - ${item.description}`)
          }
        }
        if (plan.summary) sections.push("", "## Summary", "", plan.summary)
        if (planArtifacts && planArtifacts.length > 0) {
          sections.push("", "## Outputs", "")
          for (const artifact of planArtifacts) {
            sections.push(
              artifact.url
                ? `- [${artifact.path}](${artifact.url})`
                : `- \`${artifact.path}\``
            )
          }
        }
        sections.push("", "## Conversation", "")
      } else {
        sections.push("# Thread", "")
      }

      const headingLevel = isPlan ? 3 : 2
      if (root) sections.push(messageToMarkdown(root, headingLevel))
      for (const message of orderedMessages) {
        sections.push("", messageToMarkdown(message, headingLevel))
      }

      await navigator.clipboard.writeText(sections.join("\n").trim())
      if (actionsMenuTriggerRef.current) {
        anchoredToastManager.add({
          data: { tooltipStyle: true },
          id: `copy-${isPlan ? "plan" : "thread"}-markdown`,
          positionerProps: {
            anchor: actionsMenuTriggerRef.current,
            sideOffset: 6,
          },
          timeout: 1800,
          title: `${isPlan ? "Plan" : "Thread"} copied`,
        })
      }
    } catch {
      toast.error(`Couldn't copy ${isPlan ? "plan" : "thread"}`)
    }
  }, [fetchPage, isPlan, messages, rootMessage, plan, planArtifacts])

  // Files the team fed the plan, gathered from the loaded slice of the
  // thread (sources ≠ outputs: uploads stay plain links, artifacts open the
  // viewer).
  const planSources = useMemo<PlanSourceFile[]>(() => {
    if (!isPlan) return []
    const seen = new Map<string, PlanSourceFile>()
    const collect = (msg: Message | null) => {
      for (const attachment of msg?.attachments ?? []) {
        if (seen.has(attachment.url)) continue
        seen.set(attachment.url, {
          url: attachment.url,
          filename: attachment.filename,
          size: attachment.size,
          contentType: attachment.contentType,
        })
      }
    }
    collect(rootMessage)
    for (const msg of [...messages].reverse()) collect(msg)
    return [...seen.values()]
  }, [isPlan, rootMessage, messages])

  // Opening a thread mid-run replays the durable trace into the thread cache.
  useLorRunReplay({
    queryClient,
    channelId: view.channelId,
    messages: rootMessage ? [rootMessage, ...messages] : messages,
  })

  // Messages queued behind the active run — surfaced above the composer with
  // steer/remove actions while Lor is working.
  const pendingLorMessage = useMemo(
    () => messages.find((message) => message.status === "pending"),
    [messages]
  )
  const pendingLorMessageId = pendingLorMessage?.id
  // The local Lor turn shown on send has no server id yet.
  const serverPendingLorId =
    pendingLorMessageId && !isOptimisticLorTurn(pendingLorMessageId)
      ? pendingLorMessageId
      : undefined
  const stopLor = useStopLorRun()
  const stopLorRun = stopLor.mutate
  // Stop pressed before Lor's real turn arrived: sent once it does.
  const [stopOnStart, setStopOnStart] = useState(false)
  useEffect(() => {
    if (!stopOnStart) return
    if (!pendingLorMessage) setStopOnStart(false)
    else if (serverPendingLorId) {
      stopLorRun(pendingLorMessage)
      setStopOnStart(false)
    }
  }, [stopOnStart, pendingLorMessage, serverPendingLorId, stopLorRun])
  const { queuedIds, addOptimistic, removeOptimistic } = useRunQueue({
    socket,
    channelId: view.channelId,
    threadRootId: view.threadRootId,
    pendingLorMessageId: serverPendingLorId,
  })
  useEffect(() => {
    removeQueuedOptimisticRef.current = removeOptimistic
  }, [removeOptimistic])
  const queuedMessages = useMemo(
    () =>
      queuedIds
        .map((id) => messages.find((m) => m.id === id))
        .filter((m): m is Message => Boolean(m)),
    [queuedIds, messages]
  )
  const queuedMessageSteering = useQueuedMessageSteering({
    messages: queuedMessages,
    currentUserId,
    pendingNonces,
  })

  const { handleReact } = useMessageReactions({
    socket,
    queryClient,
    channelId: view.channelId,
    threadRootId: view.threadRootId,
    currentUserId,
    currentUserName: session?.user.name,
  })
  const { handleDelete } = useMessageDeletion({
    socket,
    queryClient,
    channelId: view.channelId,
    threadRootId: view.threadRootId,
  })
  const { handleEdit } = useMessageEditing({
    socket,
    queryClient,
    channelId: view.channelId,
    threadRootId: view.threadRootId,
  })

  const fileUpload = useFileUpload(view.channelId)

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        void fileUpload.addFiles(acceptedFiles)
      }
    },
    [fileUpload.addFiles]
  )

  const { getRootProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  })

  const { typingUsers, emitTyping } = useTypingIndicator({
    socket,
    channelId: view.channelId,
    currentUserId,
    threadRootId: view.threadRootId,
  })

  const { replyingTo, setReplyingTo, clearReply } = useReplyState()

  // Drop the quote-reply draft when switching to a different thread.
  useEffect(() => {
    clearReply()
  }, [view.threadRootId, clearReply])

  const mentionCandidates = useMentionCandidates(
    view.workspaceSlug,
    view.channelId,
    { broadcasts: !sessionView }
  )
  const channelPeople = useChannelPeople(view.workspaceSlug, view.channelId)
  // Local Lor turns by the nonce of the send that showed them.
  const lorTurnsRef = useRef(new Map<string, string>())
  // What a send changes before the server answers. The writer and the people
  // they mention join the subscribers (and the writer's sidebar gets the
  // session). In a session, a follow-up to an idle Lor shows Lor working: its
  // turn, Stop and the sidebar spinner. @Lor in a human thread starts a new
  // session instead, so it skips all of this.
  const showSendEffects = (
    nonce: string,
    options?: { mentions: Message["mentions"]; toPeople?: boolean }
  ) => {
    const mentions = options?.mentions ?? []
    if (!sessionView && mentions.some((m) => m.id === LOR_USER_ID)) return
    const wasSubscribed =
      queryClient
        .getQueryData<ThreadSubscriber[]>(
          threadSubscribersKey(view.threadRootId)
        )
        ?.some((person) => person.id === currentUserId) ?? true
    const ids = new Set([currentUserId, ...mentions.map((m) => m.id)])
    showWriteSubscribers(
      queryClient,
      view.threadRootId,
      channelPeople
        .filter((person) => ids.has(person.userId))
        .map((person) => ({
          id: person.userId,
          name: person.name,
          image: person.image,
          avatarColor: person.avatarColor,
        }))
    )
    const agentSession = sessionView
      ? cachedSessionForThread(queryClient, view.threadRootId)
      : undefined
    if (!agentSession || agentSession.archivedAt) return
    const toLor = !options?.toPeople && !pendingLorMessage
    if (toLor) {
      const lorAuthor = messages.find((m) => m.authorId === LOR_USER_ID)
        ?.author ?? { id: LOR_USER_ID, name: "Lor", image: null }
      const turnId = showOptimisticLorTurn(queryClient, view.threadRootId, {
        nonce,
        channelId: view.channelId,
        lorAuthor,
      })
      lorTurnsRef.current.set(nonce, turnId)
      // Nothing came back (a lost event): the refetched thread decides.
      setTimeout(
        () => dropOptimisticLorTurns(queryClient, view.threadRootId, turnId),
        LOR_TURN_TIMEOUT_MS
      )
    }
    const target = {
      workspaceId: agentSession.workspaceId,
      channelId: agentSession.channelId,
      sessionId: agentSession.id,
    }
    void cancelSidebarFetch(queryClient, agentSession.workspaceId).then(() => {
      if (!wasSubscribed) {
        patchSidebarSession(queryClient, target, {
          show: sidebarRowFor(agentSession),
        })
      }
      if (toLor) {
        patchSidebarSession(queryClient, target, {
          state: "running",
          lastActivityAt: new Date().toISOString(),
        })
      }
    })
  }
  // A failed send takes back what showSendEffects showed.
  useEffect(() => {
    undoSendRef.current = (nonce) => {
      const turnId = lorTurnsRef.current.get(nonce)
      if (turnId) {
        lorTurnsRef.current.delete(nonce)
        dropOptimisticLorTurns(queryClient, view.threadRootId, turnId)
      }
      void queryClient.invalidateQueries({
        queryKey: threadSubscribersKey(view.threadRootId),
      })
      const agentSession = cachedSessionForThread(
        queryClient,
        view.threadRootId
      )
      if (agentSession) {
        settleSidebarSessions(queryClient, agentSession.workspaceId)
      }
    }
  }, [queryClient, view.threadRootId])
  // A typer who hasn't posted here yet still gets their photo from members.
  const typingPeople = useMemo(
    () =>
      typingUsers.map((user) => {
        const participant = participants.find(
          (person) => person.id === user.userId
        )
        const member = mentionCandidates.find(
          (candidate) => candidate.id === user.userId
        )
        const memberImage = member && "image" in member ? member.image : null
        return {
          ...user,
          image: participant?.image ?? memberImage,
          avatarColor: participant?.avatarColor ?? null,
        }
      }),
    [typingUsers, participants, mentionCandidates]
  )
  // Voice channel threads are call chats; their root is a silent placeholder.
  const isCallChat = channel?.type === "voice"
  const composerDestination = sessionView
    ? "session"
    : channel?.type === "text"
      ? "thread"
      : undefined
  // Who a message "To subscribers" reaches, shown as faces in the composer.
  const { data: subscribers } = useQuery({
    ...threadSubscribersQueryOptions(view),
    enabled: Boolean(sessionView),
  })
  const otherSubscribers = useMemo(
    () => subscribers?.filter((person) => person.id !== currentUserId),
    [subscribers, currentUserId]
  )

  // Threads render top-down (oldest → newest). The API + cache hold
  // newest-first, so reverse for display.
  // Queued messages live only in the composer's queue pill until the drain
  // releases them — the transcript skips them (Codex model). Old calls'
  // summary cards stay out of the chat: the Summary tab shows the summary.
  const orderedReplies = useMemo(
    () =>
      [...messages]
        .reverse()
        .filter((m) => !queuedIds.includes(m.id) && m.type !== "call_summary"),
    [messages, queuedIds]
  )
  // First load: the skeleton shows, and a session's input line waits.
  const isAwaitingReplies = isLoading && orderedReplies.length === 0
  // Anchors are only for the initial view of an existing thread. Freeze them
  // from the first loaded snapshot so a message sent while this panel is open
  // stays at the live edge instead of creating an empty anchored viewport.
  const openingAnchorsRef = useRef({
    threadRootId: view.threadRootId,
    initialized: false,
    messageIds: new Set<string>(),
  })
  if (openingAnchorsRef.current.threadRootId !== view.threadRootId) {
    openingAnchorsRef.current = {
      threadRootId: view.threadRootId,
      initialized: false,
      messageIds: new Set<string>(),
    }
  }
  if (!isLoading && !openingAnchorsRef.current.initialized) {
    openingAnchorsRef.current.initialized = true
    // Anchor only triggers of runs still streaming at open. The scroller pins
    // an anchor to the top with a spacer below so the answer can grow into
    // it — right for a live run, but anchoring a *completed* run from
    // history leaves that spacer as a dead gap under the last message
    // (thread opens with messages hoisted up and blank space above the
    // composer). Finished threads open at the live edge instead.
    openingAnchorsRef.current.messageIds = new Set(
      messages
        .filter((message) => message.status === "pending")
        .map((message) => message.lorTriggerMessageId)
        .filter((id): id is string => Boolean(id))
    )
  }
  const openingLorTriggerMessageIds = openingAnchorsRef.current.messageIds

  const scrollRef = useRef<HTMLDivElement>(null)
  const {
    commandRef: messageScrollCommandRef,
    register: registerScrollCommand,
    scrollToEndRef,
    registerScrollToEnd,
  } = useRegisteredMessageScroller()
  const [sendScrollVersion, setSendScrollVersion] = useState(0)
  // Session only: the bar under the document the inline composer's tools
  // render into.
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(
    null
  )
  useLayoutEffect(() => {
    if (!sendScrollVersion) return
    scrollToEndRef.current?.({ behavior: "auto" })
    // Query notifications and composer resizing may land after the send commit.
    const viewport = scrollRef.current
    const frame = window.requestAnimationFrame(() => {
      if (viewport && scrollRef.current === viewport) {
        scrollToEndRef.current?.({ behavior: "auto" })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [sendScrollVersion, scrollToEndRef])

  // Scoped to this panel's scroll container so it never grabs the channel
  // feed's copy of the same message id (the root appears in both).
  const handleJumpWithinThread = useCallback(
    (messageId: string) => {
      const scrollToTarget = () => {
        const didScroll =
          messageScrollCommandRef.current?.(messageId, {
            align: "center",
            behavior: jumpScrollBehavior(),
          }) ?? false
        if (didScroll) {
          window.requestAnimationFrame(() =>
            highlightMessage(messageId, scrollRef.current ?? document)
          )
        }
        return didScroll
      }

      if (scrollToTarget()) return
      // Resolve the location first (cached; citations prefetch it on hover) so
      // a message outside this thread navigates without a wasted thread fetch.
      void (async () => {
        const loc = await resolveMessageLocation(messageId)
        if (loc && (loc.threadRootId ?? loc.messageId) !== view.threadRootId) {
          navigateToMessage({
            id: loc.messageId,
            channelId: loc.channelId,
            threadRootId: loc.threadRootId,
          })
          return
        }
        if (!(await ensureMessage(messageId))) {
          toast.error("Couldn't find that message")
          return
        }
        window.requestAnimationFrame(scrollToTarget)
      })().catch(() => toast.error("Couldn't load that message"))
    },
    [
      ensureMessage,
      messageScrollCommandRef,
      resolveMessageLocation,
      navigateToMessage,
      view.threadRootId,
    ]
  )

  // Search results can deep-link to an older reply that is outside the
  // thread's initial live-tail page. Load that slice, then center + highlight
  // the exact result once the panel's scroller is ready.
  useEffect(() => {
    if (!view.targetMessageId) return
    handleJumpWithinThread(view.targetMessageId)
  }, [view.targetMessageId, handleJumpWithinThread])

  const handleReaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      signalMessageScrollerInteraction(
        event.target,
        messageScrollCommandRef.current
      )
    },
    [messageScrollCommandRef]
  )
  // Load-older sentinel at the top.
  const olderSentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sentinel = olderSentinelRef.current
    const container = scrollRef.current
    if (!sentinel || !container || !hasOlder) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingOlder) {
          void fetchOlder()
        }
      },
      { root: container, rootMargin: "200px" }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasOlder, isFetchingOlder, fetchOlder])

  // A session's heading renders once the oldest page is loaded; until then,
  // and once it scrolls away, the header carries the title.
  const [headingElement, setHeadingElement] = useState<HTMLDivElement | null>(
    null
  )
  const [headingVisible, setHeadingVisible] = useState(true)
  useEffect(() => {
    const container = scrollRef.current
    if (!headingElement || !container) {
      if (hasOlder) setHeadingVisible(false)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => setHeadingVisible(entries[0]?.isIntersecting ?? false),
      { root: container }
    )
    observer.observe(headingElement)
    return () => observer.disconnect()
  }, [headingElement, hasOlder])

  const channelContext = useMemo(
    () => ({
      type: "channel" as const,
      name: "thread",
    }),
    []
  )

  // When older pages are still unloaded, `orderedReplies.length` is just the
  // loaded slice — fall back to the root summary's total. Once `hasOlder` is
  // false the loaded array is the full thread.
  const summaryTotal = rootMessage?.threadSummary?.replyCount
  const dividerCount = hasOlder ? summaryTotal : orderedReplies.length
  // A session's input line reads as the document's next line, with a faint
  // placeholder so the eye finds where to write.
  const composerPlaceholder = isCallChat ? "Message the call…" : "Reply…"
  const showDivider =
    !isCallChat &&
    !sessionView &&
    !isLoading &&
    orderedReplies.length > 0 &&
    dividerCount !== undefined &&
    dividerCount > 0

  const openCallTab = (tab: CallTab, transcriptAtMs?: number) =>
    setView({
      ...view,
      composerDraft: undefined,
      callTab: tab,
      transcriptAtMs,
    })
  // Keyed so the summary, chat and transcript returns below share one Tabs
  // instance; a remount would skip the active tab's slide.
  const callTabs = voiceSessionId ? (
    <Tabs
      key="call-tabs"
      value={callTab}
      onValueChange={(value) =>
        openCallTab(
          value === "summary" || value === "transcript" ? value : "chat"
        )
      }
      className="border-border/70 border-b px-4 pb-3"
    >
      <TabsList>
        {voiceSessionEnded && (
          <TabsTab value="summary" className="grow-0">
            Summary
          </TabsTab>
        )}
        <TabsTab value="chat" className="grow-0">
          Chat
        </TabsTab>
        <TabsTab value="transcript" className="grow-0">
          Transcript
        </TabsTab>
      </TabsList>
    </Tabs>
  ) : null

  if ((showTranscript || showSummary) && voiceSessionId) {
    return (
      <div className="@container relative flex h-full w-full flex-col">
        <RightPanelHeader
          title={callTitle}
          workspaceSlug={view.workspaceSlug}
          channelId={view.channelId}
          className="border-b-0"
        />
        {callTabs}
        {showSummary ? (
          <CallSummaryPanel
            sessionId={voiceSessionId}
            query={callSummary}
            onOpenMoment={(atMs) => openCallTab("transcript", atMs)}
          />
        ) : (
          <CallTranscript
            // A new citation target remounts, so it scrolls again.
            key={view.transcriptAtMs ?? "start"}
            sessionId={voiceSessionId}
            live={call?.sessionId === voiceSessionId}
            atMs={view.transcriptAtMs}
          />
        )}
      </div>
    )
  }

  // A thread's composer sits under the scroller; a session's is the document's
  // last line, with its tools in the bar under the scroller.
  const composer = (
    <>
      {!sessionView && (
        <TypingIndicator users={typingUsers} className="from-sidebar" />
      )}
      <RunQueuePill
        messages={queuedMessages}
        currentUserId={currentUserId}
        pendingNonces={pendingNonces}
        onSteer={queuedMessageSteering.steerMessage}
        steeringMessageId={queuedMessageSteering.steeringMessageId}
        variant={sessionView ? "document" : "box"}
      />
      {/* Right above the reply line, like other people's draft lines. */}
      {sessionView && <DocumentTypingIndicator people={typingPeople} />}
      <MessageInput
        key={view.threadRootId}
        composerDraft={view.composerDraft}
        onComposerDraftConsumed={consumeComposerDraft}
        context={channelContext}
        channelId={view.channelId}
        contextScopeKey={view.threadRootId}
        placeholder={composerPlaceholder}
        destination={composerDestination}
        subscribers={otherSubscribers}
        variant={sessionView ? "inline" : "box"}
        toolbarTarget={toolbarTarget}
        onTypeToFocus={
          sessionView
            ? () => scrollToEndRef.current?.({ behavior: jumpScrollBehavior() })
            : undefined
        }
        gutter={
          <UserAvatar
            name={session?.user.name}
            src={session?.user.image}
            avatarColor={
              participants.find((person) => person.id === currentUserId)
                ?.avatarColor
            }
            size="sm"
            className="size-7"
          />
        }
        notice={
          <SessionStartedNote
            session={sessionStart.started}
            workspaceSlug={view.workspaceSlug}
          />
        }
        onSend={(content, options) => {
          const nonce = handleSend(content, options)
          if (nonce) showSendEffects(nonce, options)
          // Retire opening anchors so a later resize cannot recapture them.
          openingAnchorsRef.current.messageIds.clear()
          scrollToEndRef.current?.({ behavior: "auto" })
          setSendScrollVersion((version) => version + 1)
          // Lor is mid-answer in this thread, so a message for Lor will
          // queue — show it in the pill immediately instead of waiting for
          // the routed round trip.
          if (nonce && pendingLorMessageId && !options?.toPeople) {
            addOptimistic(nonce)
          }
        }}
        currentUserId={currentUserId}
        replyingTo={replyingTo}
        onCancelReply={clearReply}
        mentionCandidates={mentionCandidates}
        pendingAttachments={fileUpload.attachments}
        addFiles={fileUpload.addFiles}
        removeAttachment={fileUpload.removeAttachment}
        clearAttachments={fileUpload.clearAttachments}
        getUploadedAttachments={fileUpload.getUploadedAttachments}
        isUploading={fileUpload.isUploading}
        onTyping={emitTyping}
        onStop={
          pendingLorMessage
            ? () =>
                serverPendingLorId
                  ? stopLorRun(pendingLorMessage)
                  : setStopOnStart(true)
            : undefined
        }
        isStopping={
          stopLor.isPending ||
          stopOnStart ||
          Boolean(pendingLorMessage?.stopRequested)
        }
        canSteerQueued={queuedMessageSteering.canSteerLatestOwnMessage}
        onSteerQueued={queuedMessageSteering.steerLatestOwnMessage}
        isSteeringQueued={queuedMessageSteering.isSteering}
      />
    </>
  )

  return (
    <div
      {...getRootProps()}
      className="@container relative flex h-full w-full flex-col"
    >
      <DropZoneOverlay isDragActive={isDragActive} />
      {sessionView && (
        <ForwardDialog
          message={forwarding}
          workspaceSlug={view.workspaceSlug}
          target={{
            channelId: view.channelId,
            channelName: channel?.name ?? "channel",
          }}
          onClose={() => setForwarding(null)}
        />
      )}
      {sessionView ? (
        sessionView.header({
          lorRunning: Boolean(pendingLorMessage),
          headingVisible,
        })
      ) : (
        <RightPanelHeader
          // A call chat takes Lor's name for the call once it's summarized.
          title={isPlan ? "Plan" : isCallChat ? callTitle : "Thread"}
          workspaceSlug={view.workspaceSlug}
          channelId={view.channelId}
          titleAdornment={
            planStatusMeta ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                <HugeiconsIcon
                  icon={planStatusMeta.icon}
                  size={14}
                  className={
                    planStatusMeta.spin
                      ? "animate-spin text-primary"
                      : "text-primary"
                  }
                />
                {planStatusMeta.label}
              </span>
            ) : undefined
          }
          className={showWorkHeader || callTabs ? "border-b-0" : undefined}
          actions={
            <>
              <ThreadSubscribers
                workspaceSlug={view.workspaceSlug}
                channelId={view.channelId}
                threadRootId={view.threadRootId}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      ref={actionsMenuTriggerRef}
                      type="button"
                      aria-label={`${isPlan ? "Plan" : "Thread"} actions`}
                      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground data-popup-open:bg-foreground/5 data-popup-open:text-foreground"
                    />
                  }
                >
                  <HugeiconsIcon
                    icon={MoreHorizontalIcon}
                    className="size-4"
                    strokeWidth={2}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end" className="w-60">
                  {!isCallChat && (
                    <DropdownMenuItem onClick={handleViewInChannel}>
                      <HugeiconsIcon icon={CornerUpRightIcon} strokeWidth={2} />
                      Go to message
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => void handleCopyAsMarkdown()}>
                    <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                    {`Copy ${isPlan ? "plan" : "thread"} as Markdown`}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      )}
      {callTabs}

      {showWorkHeader && (
        <ThreadWorkHeader
          channelId={view.channelId}
          threadRootId={view.threadRootId}
          sources={planSources}
          activityMessage={activityMessage}
        />
      )}

      <MessageScrollerProvider
        key={view.threadRootId}
        autoScroll
        defaultScrollPosition="last-anchor"
        scrollEdgeThreshold={64}
        scrollPreviousItemPeek={64}
      >
        <MessageScrollerCommandBridge
          register={registerScrollCommand}
          registerScrollToEnd={registerScrollToEnd}
        />
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport
            ref={scrollRef}
            onPointerDown={handleReaderPointerDown}
            reconcileFollowOutput
            followOutputThreshold={64}
            className="[overflow-anchor:none]"
            aria-label="Thread messages"
          >
            <MessageScrollerContent
              aria-busy={Boolean(pendingLorMessage)}
              // A session reads top-down like a document; a thread hugs its
              // composer like chat.
              className={
                sessionView ? "mx-auto w-full max-w-3xl pt-4" : "justify-end"
              }
            >
              {rootMessageForRender && !isCallChat && !sessionView && (
                <MessageScrollerItem
                  messageId={rootMessageForRender.id}
                  scrollAnchor={openingLorTriggerMessageIds.has(
                    rootMessageForRender.id
                  )}
                  className="pt-2"
                >
                  <MessageItem
                    message={rootMessageForRender}
                    showHeader={true}
                    wrapContentAroundAvatar
                    currentUserId={currentUserId}
                    isReplyTarget={replyingTo?.id === rootMessageForRender.id}
                    onReact={handleReact}
                    onReply={setReplyingTo}
                    onDelete={handleDelete}
                    onEdit={handleEdit}
                    onJumpToMessage={handleJumpWithinThread}
                    mentionCandidates={mentionCandidates}
                  />
                </MessageScrollerItem>
              )}

              {showDivider && (
                <MessageScrollerItem>
                  <div className="flex items-center gap-3 px-4 pt-3 pb-1 text-[12px] text-muted-foreground">
                    <MorphText className="font-medium">
                      {`${dividerCount} ${dividerCount === 1 ? "reply" : "replies"}`}
                    </MorphText>
                    <div className="h-px flex-1 bg-border/60" />
                  </div>
                </MessageScrollerItem>
              )}

              {sessionView?.heading && !hasOlder && (
                <MessageScrollerItem className="px-4 pt-6 pb-3">
                  <div ref={setHeadingElement}>{sessionView.heading}</div>
                </MessageScrollerItem>
              )}

              {hasOlder && (
                <MessageScrollerItem>
                  <div
                    ref={olderSentinelRef}
                    className="flex justify-center py-3"
                  >
                    {isFetchingOlder && (
                      <Spinner className="size-5 text-muted-foreground motion-reduce:animate-none" />
                    )}
                  </div>
                </MessageScrollerItem>
              )}

              {isAwaitingReplies ? (
                <MessageScrollerItem className="flex flex-col py-2">
                  {THREAD_SKELETON_GROUPS.map((group) => (
                    <div
                      key={group.key}
                      className={cn("px-4", sessionView ? "pt-3" : "py-1")}
                    >
                      <div className="flex gap-3">
                        {/* A session's skeleton matches its document rows:
                            a small gutter avatar and text, no name row. */}
                        <Skeleton
                          className={cn(
                            "shrink-0 rounded-full",
                            sessionView ? "-mt-0.5 size-7" : "mt-0.5 size-9"
                          )}
                        />
                        <div className="flex-1 space-y-2">
                          {!sessionView && (
                            <div className="flex items-baseline gap-2">
                              <Skeleton
                                className="h-3 rounded"
                                style={{ width: group.nameWidth }}
                              />
                              <Skeleton className="h-2.5 w-10 rounded" />
                            </div>
                          )}
                          {group.lines.map((width, i) => (
                            <Skeleton
                              key={`${group.key}-${i}`}
                              className="h-3 rounded"
                              style={{ width }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </MessageScrollerItem>
              ) : (
                orderedReplies.map((msg, i) => {
                  const prev = orderedReplies[i - 1]
                  const isDateBoundary =
                    !prev || !isSameDay(msg.createdAt, prev.createdAt)
                  const isWithinGroupWindow =
                    !!prev &&
                    differenceInMinutes(msg.createdAt, prev.createdAt) <=
                      MESSAGE_GROUP_WINDOW_MINUTES
                  // Events (a loop's "ran on schedule" line) are muted rows
                  // that break the author group, so Lor's reply after one
                  // keeps its avatar.
                  if (msg.type === "event") {
                    return (
                      <MessageScrollerItem key={msg.id} messageId={msg.id}>
                        <ChannelEventRow
                          events={[msg]}
                          layout={sessionView ? "document" : "chat"}
                        />
                      </MessageScrollerItem>
                    )
                  }
                  const showHeader =
                    isDateBoundary ||
                    !prev ||
                    prev.authorId !== msg.authorId ||
                    prev.type === "event" ||
                    !isWithinGroupWindow
                  return (
                    <MessageScrollerItem
                      key={msg.id}
                      messageId={msg.id}
                      scrollAnchor={openingLorTriggerMessageIds.has(msg.id)}
                    >
                      <MessageItem
                        message={msg}
                        showHeader={showHeader}
                        wrapContentAroundAvatar={!sessionView}
                        layout={sessionView ? "document" : "chat"}
                        currentUserId={currentUserId}
                        isReplyTarget={replyingTo?.id === msg.id}
                        onReact={handleReact}
                        onReply={setReplyingTo}
                        onDelete={handleDelete}
                        onEdit={handleEdit}
                        onJumpToMessage={handleJumpWithinThread}
                        mentionCandidates={mentionCandidates}
                        onForward={sessionView ? setForwarding : undefined}
                      />
                    </MessageScrollerItem>
                  )
                })
              )}

              {/* Inline input line: the document's last line, reached by
                  scrolling to the end like any document (never pinned). */}
              {sessionView &&
                !sessionView.archivedBar &&
                !isAwaitingReplies && <div className="pt-3">{composer}</div>}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerJumpToLatest
            newestMessageId={
              orderedReplies.at(-1)?.id ?? rootMessage?.id ?? null
            }
            viewportRef={scrollRef}
            isLorResponding={Boolean(pendingLorMessage)}
          />
          {sessionView && <SessionTurnRail messages={orderedReplies} />}
        </MessageScroller>

        {sessionView?.archivedBar ? (
          <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 pb-3">
            {sessionView.archivedBar}
          </div>
        ) : sessionView ? (
          <div
            ref={setToolbarTarget}
            className="mx-auto w-full max-w-3xl shrink-0 px-4 py-2"
          />
        ) : (
          <div className="shrink-0 pt-2">{composer}</div>
        )}
      </MessageScrollerProvider>
    </div>
  )
}
