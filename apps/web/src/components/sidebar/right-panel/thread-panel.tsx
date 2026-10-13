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
import { Tabs, TabsList, TabsTab } from "@repo/ui/components/tabs"
import { anchoredToastManager, toast } from "@repo/ui/components/toast"
import { formatDateTime } from "@repo/utils/date"
import {
  type InfiniteData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react"
import { useDropzone } from "react-dropzone"
import { MessageInput } from "@/components/chat/composer/message-input"
import { ConversationMessages } from "@/components/chat/conversation-messages"
import { DropZoneOverlay } from "@/components/chat/drop-zone-overlay"
import { MessageItem } from "@/components/chat/message-item"
import { scrollToMessage } from "@/components/chat/message-list"
import {
  MessageScrollerCommandBridge,
  MessageScrollerJumpToLatest,
} from "@/components/chat/message-scroller-controls"
import { RunQueuePill } from "@/components/chat/run-queue-pill"
import { ThreadSubscribers } from "@/components/chat/thread-subscribers"
import {
  type PlanSourceFile,
  ThreadWorkHeader,
} from "@/components/chat/thread-work-header"
import { TypingIndicator } from "@/components/chat/typing-indicator"
import { SessionStartedNote } from "@/components/session/session-started-note"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type {
  CallTab,
  ThreadSidebarView,
} from "@/components/sidebar/right-panel/right-sidebar-types"
import { MorphText } from "@/components/ui/morph-text"
import { CallSummaryPanel } from "@/components/voice/call-summary"
import { CallTranscript } from "@/components/voice/call-transcript"
import { useSocket } from "@/context/socket-context"
import { useVoiceCall } from "@/context/voice-call-context"
import { useCallSummary } from "@/hooks/use-call-summary"
import { usePlanForThread } from "@/hooks/use-channel-plans"
import { useConversationScroll } from "@/hooks/use-conversation-scroll"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useLorRunControls } from "@/hooks/use-lor-run-controls"
import { useMarkThreadRead } from "@/hooks/use-mark-thread-read"
import {
  useChannelPeople,
  useMentionCandidates,
} from "@/hooks/use-mention-candidates"
import { useMessageDeletion } from "@/hooks/use-message-deletion"
import { useMessageEditing } from "@/hooks/use-message-editing"
import { useMessageReactions } from "@/hooks/use-message-reactions"
import { useMessageSending } from "@/hooks/use-message-sending"
import { usePlanArtifacts } from "@/hooks/use-plan"
import { useReplyState } from "@/hooks/use-reply-state"
import { useSessionStart } from "@/hooks/use-session-start"
import {
  type FetchPageParams,
  fetchThreadPage,
  useThreadMessages,
} from "@/hooks/use-thread-messages"
import {
  showWriteSubscribers,
  threadSubscribersKey,
} from "@/hooks/use-thread-subscribers"
import { useTypingIndicator } from "@/hooks/use-typing-indicator"
import type { Message } from "@/lib/api-types"
import { channelQueryOptions } from "@/lib/channel-query"
import { PLAN_STATUS_META } from "@/lib/plan-ui"

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

// A human thread or a call chat in the right panel. Lor sessions render on
// their own page (SessionDocument) and never open here.
export function ThreadPanel({ view }: { view: ThreadSidebarView }) {
  const { consumeComposerDraft, setView, clearView } = useRightSidebar()
  const { call } = useVoiceCall()
  const queryClient = useQueryClient()
  const socket = useSocket()
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user.id

  const navigate = useNavigate()
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
    sessionStart: channel?.type === "text" ? sessionStart.handlers : undefined,
  })

  const {
    messages,
    root: threadApiRoot,
    voiceSessionId,
    voiceSessionTitle,
    voiceSessionEnded,
    sessionId: threadSessionId,
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

  // A Lor session never shows in the thread panel: ?threadId deep links,
  // refresh and Back land on its page instead.
  const redirectSessionId = threadSessionId
  useEffect(() => {
    if (!redirectSessionId) return
    clearView()
    void navigate({
      to: "/$workspaceSlug/session/$sessionId",
      params: {
        workspaceSlug: view.workspaceSlug,
        sessionId: redirectSessionId,
      },
      replace: true,
    })
  }, [redirectSessionId, clearView, navigate, view.workspaceSlug])

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
  const showWorkHeader = isPlan || activityMessage !== null

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

  const lorRun = useLorRunControls({
    socket,
    queryClient,
    channelId: view.channelId,
    threadRootId: view.threadRootId,
    messages,
    rootMessage,
    currentUserId,
    pendingNonces,
  })
  const { pendingLorMessage, queuedIds, queuedMessages, removeOptimistic } =
    lorRun
  useEffect(() => {
    removeQueuedOptimisticRef.current = removeOptimistic
  }, [removeOptimistic])

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
    { broadcasts: true }
  )
  const channelPeople = useChannelPeople(view.workspaceSlug, view.channelId)
  // The writer and the people they mention join the subscribers before the
  // server answers. @Lor starts a new session instead, so it skips this.
  const showSendEffects = (options?: { mentions: Message["mentions"] }) => {
    const mentions = options?.mentions ?? []
    if (mentions.some((m) => m.id === LOR_USER_ID)) return
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
  }
  // A failed send takes back what showSendEffects showed.
  useEffect(() => {
    undoSendRef.current = () => {
      void queryClient.invalidateQueries({
        queryKey: threadSubscribersKey(view.threadRootId),
      })
    }
  }, [queryClient, view.threadRootId])
  // Voice channel threads are call chats; their root is a silent placeholder.
  const isCallChat = channel?.type === "voice"

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
  // First load: the skeleton shows.
  const isAwaitingReplies = isLoading && orderedReplies.length === 0
  const scroll = useConversationScroll({
    threadRootId: view.threadRootId,
    targetMessageId: view.targetMessageId,
    messages,
    isLoading,
    ensureMessage,
  })
  const { scrollRef } = scroll

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
  const composerPlaceholder = isCallChat ? "Message the call…" : "Reply…"
  const showDivider =
    !isCallChat &&
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

  if (redirectSessionId) return null

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

  const composer = (
    <>
      <TypingIndicator users={typingUsers} className="from-sidebar" />
      <RunQueuePill
        messages={queuedMessages}
        currentUserId={currentUserId}
        pendingNonces={pendingNonces}
        onSteer={lorRun.steering.steerMessage}
        steeringMessageId={lorRun.steering.steeringMessageId}
        variant="box"
      />
      <MessageInput
        key={view.threadRootId}
        composerDraft={view.composerDraft}
        onComposerDraftConsumed={consumeComposerDraft}
        context={channelContext}
        channelId={view.channelId}
        contextScopeKey={view.threadRootId}
        placeholder={composerPlaceholder}
        destination={channel?.type === "text" ? "thread" : undefined}
        notice={
          <SessionStartedNote
            session={sessionStart.started}
            workspaceSlug={view.workspaceSlug}
          />
        }
        onSend={(content, options) => {
          const nonce = handleSend(content, options)
          if (nonce) showSendEffects(options)
          scroll.scrollAfterSend()
          // Lor is mid-answer in this thread, so a message for Lor will
          // queue — show it in the pill immediately instead of waiting for
          // the routed round trip.
          if (nonce && pendingLorMessage && !options?.toPeople) {
            lorRun.addOptimistic(nonce)
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
        onStop={lorRun.onStop}
        isStopping={lorRun.isStopping}
        canSteerQueued={lorRun.steering.canSteerLatestOwnMessage}
        onSteerQueued={lorRun.steering.steerLatestOwnMessage}
        isSteeringQueued={lorRun.steering.isSteering}
      />
    </>
  )

  return (
    <div
      {...getRootProps()}
      className="@container relative flex h-full w-full flex-col"
    >
      <DropZoneOverlay isDragActive={isDragActive} />
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
          register={scroll.registerScrollCommand}
          registerScrollToEnd={scroll.registerScrollToEnd}
        />
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport
            ref={scrollRef}
            onPointerDown={scroll.onReaderPointerDown}
            reconcileFollowOutput
            followOutputThreshold={64}
            className="[overflow-anchor:none]"
            aria-label="Thread messages"
          >
            <MessageScrollerContent
              aria-busy={Boolean(pendingLorMessage)}
              className="justify-end"
            >
              {rootMessageForRender && !isCallChat && (
                <MessageScrollerItem
                  messageId={rootMessageForRender.id}
                  scrollAnchor={scroll.openingLorTriggerMessageIds.has(
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
                    onJumpToMessage={scroll.jumpToMessage}
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

              <ConversationMessages
                layout="chat"
                replies={orderedReplies}
                isAwaitingReplies={isAwaitingReplies}
                hasOlder={hasOlder}
                isFetchingOlder={isFetchingOlder}
                fetchOlder={fetchOlder}
                scrollRef={scrollRef}
                anchorIds={scroll.openingLorTriggerMessageIds}
                replyingToId={replyingTo?.id}
                itemProps={{
                  currentUserId,
                  onReact: handleReact,
                  onReply: setReplyingTo,
                  onDelete: handleDelete,
                  onEdit: handleEdit,
                  onJumpToMessage: scroll.jumpToMessage,
                  mentionCandidates,
                }}
              />
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerJumpToLatest
            newestMessageId={
              orderedReplies.at(-1)?.id ?? rootMessage?.id ?? null
            }
            viewportRef={scrollRef}
            isLorResponding={Boolean(pendingLorMessage)}
          />
        </MessageScroller>
        <div className="shrink-0 pt-2">{composer}</div>
      </MessageScrollerProvider>
    </div>
  )
}
