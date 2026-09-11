import {
  Copy01Icon,
  CornerUpRightIcon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
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
import { anchoredToastManager, toast } from "@repo/ui/components/toast"
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
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useDropzone } from "react-dropzone"
import { MessageInput } from "@/components/chat/composer/message-input"
import { DropZoneOverlay } from "@/components/chat/drop-zone-overlay"
import { MessageItem } from "@/components/chat/message-item"
import { scrollToMessage } from "@/components/chat/message-list"
import {
  highlightMessage,
  MessageScrollerCommandBridge,
  MessageScrollerJumpToLatest,
  signalMessageScrollerInteraction,
  useRegisteredMessageScroller,
} from "@/components/chat/message-scroller-controls"
import { RunQueuePill } from "@/components/chat/run-queue-pill"
import {
  type TaskSourceFile,
  TaskThreadHeader,
} from "@/components/chat/task-thread-header"
import { ThreadSubscriberStack } from "@/components/chat/thread-subscriber-stack"
import { TypingIndicator } from "@/components/chat/typing-indicator"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { ThreadSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { useSocket } from "@/context/socket-context"
import { useTaskForCard } from "@/hooks/use-channel-tasks"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useMarkThreadRead } from "@/hooks/use-mark-thread-read"
import { useMerlinRunReplay } from "@/hooks/use-merlin-stream"
import { useMessageDeletion } from "@/hooks/use-message-deletion"
import { useMessageEditing } from "@/hooks/use-message-editing"
import { useMessageReactions } from "@/hooks/use-message-reactions"
import { useMessageSending } from "@/hooks/use-message-sending"
import { useQueuedMessageSteering } from "@/hooks/use-queued-message-steering"
import { useReplyState } from "@/hooks/use-reply-state"
import { useRunQueue } from "@/hooks/use-run-queue"
import { useStopMerlinRun } from "@/hooks/use-stop-merlin-run"
import { useTaskArtifacts } from "@/hooks/use-task"
import { useThreadMessages } from "@/hooks/use-thread-messages"
import { useTypingIndicator } from "@/hooks/use-typing-indicator"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"
import { broadcastMentionCandidates } from "@/lib/broadcast-mentions"
import { TASK_STATUS_META } from "@/lib/task-ui"

const MESSAGE_GROUP_WINDOW_MINUTES = 5

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
  return (
    message.overrideName ??
    message.author.displayUsername ??
    message.author.username ??
    message.author.name
  )
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

export function ThreadPanel({ view }: { view: ThreadSidebarView }) {
  const { consumeComposerDraft } = useRightSidebar()
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
  const { data: channelCache } = useQuery<ChannelMessagesCache>({
    queryKey: ["messages", view.channelId],
    enabled: false,
  })
  // Fallback while the thread loads; its own root remains current off-route.
  const channelCacheRoot = useMemo(
    () => findMessageInChannelCache(channelCache, view.threadRootId),
    [channelCache, view.threadRootId]
  )

  const fetchThreadPage = useCallback(
    async (params: {
      around?: string
      before?: string
      after?: string
      limit: number
    }) => {
      const query: Record<string, string> = { limit: String(params.limit) }
      if (params.around) query.around = params.around
      if (params.before) query.before = params.before
      if (params.after) query.after = params.after
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].messages[":messageId"].thread.$get({
        param: {
          workspaceSlug: view.workspaceSlug,
          channelId: view.channelId,
          messageId: view.threadRootId,
        },
        query,
      })
      if (!res.ok) throw new Error("Failed to fetch thread replies")
      return res.json()
    },
    [view.workspaceSlug, view.channelId, view.threadRootId]
  )

  // Latest-ref indirection: useRunQueue mounts below (it needs the thread
  // messages), but a failed send must drop the nonce it mirrored there.
  const removeQueuedOptimisticRef = useRef<(id: string) => void>(() => {})
  const { handleSend, pendingNonces } = useMessageSending({
    socket,
    queryClient,
    channelId: view.channelId,
    currentUser: session?.user,
    threadRootId: view.threadRootId,
    onSendFailed: (nonce) => removeQueuedOptimisticRef.current(nonce),
  })

  const {
    messages,
    root: threadApiRoot,
    participants,
    isLoading,
    fetchOlder,
    hasOlder,
    isFetchingOlder,
    ensureMessage,
  } = useThreadMessages({
    channelId: view.channelId,
    threadRootId: view.threadRootId,
    fetchPage: fetchThreadPage,
    socket,
    pendingNoncesRef: pendingNonces,
  })

  const rootMessage = threadApiRoot ?? channelCacheRoot

  // An open panel means the thread is being read — advance the per-thread
  // read cursor on open and on every reply that lands while it's visible, so
  // the activity dock stays clear here and on other devices.
  const markThreadRead = useMarkThreadRead(view.workspaceSlug, view.channelId)
  const newestReplyId = messages[0]?.id ?? null
  useEffect(() => {
    if (document.visibilityState !== "visible") return
    const timer = setTimeout(() => markThreadRead(view.threadRootId), 500)
    return () => clearTimeout(timer)
  }, [view.threadRootId, newestReplyId, markThreadRead])
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        markThreadRead(view.threadRootId)
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [view.threadRootId, markThreadRead])

  // MessageItem is memoized — keep the root message prop referentially
  // stable. A fresh `{ ...rootMessage, threadSummary: null }` spread on every
  // render would defeat the memo and re-render the row on any panel render.
  const rootMessageForRender = useMemo(
    () => (rootMessage ? { ...rootMessage, threadSummary: null } : null),
    [rootMessage]
  )

  // Task threads get their own panel identity: header says Task + live
  // status, and the docked strip below carries plan/files/approval.
  const isTask = rootMessage?.type === "task_card"
  const task = useTaskForCard(view.channelId, view.threadRootId)
  const taskStatusMeta = isTask && task ? TASK_STATUS_META[task.status] : null
  const { data: taskArtifacts } = useTaskArtifacts(
    isTask ? (task?.id ?? null) : null
  )

  const handleCopyAsMarkdown = useCallback(async () => {
    try {
      const firstPage = await fetchThreadPage({ limit: 50 })
      const replies = new Map<string, Message>()
      for (const message of [...messages, ...firstPage.data]) {
        if (message.status !== "pending") replies.set(message.id, message)
      }

      let page = firstPage
      const visitedCursors = new Set<string>()
      while (!page.reachedOldest && page.beforeCursor) {
        if (visitedCursors.has(page.beforeCursor)) break
        visitedCursors.add(page.beforeCursor)
        page = await fetchThreadPage({ before: page.beforeCursor, limit: 50 })
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

      if (isTask && task) {
        sections.push(`# ${task.title}`, "", task.goal)
        sections.push(
          "",
          `**Status:** ${TASK_STATUS_META[task.status].label}`,
          `**Created:** ${formatDateTime(task.createdAt)}`
        )
        if (task.plan.length > 0) {
          sections.push("", "## Plan", "")
          for (const item of task.plan) {
            const marker = item.status === "done" ? "x" : " "
            const active = item.status === "active" ? " _(in progress)_" : ""
            sections.push(`- [${marker}] ${item.text}${active}`)
            if (item.description) sections.push(`  - ${item.description}`)
          }
        }
        if (task.summary) sections.push("", "## Summary", "", task.summary)
        if (taskArtifacts && taskArtifacts.length > 0) {
          sections.push("", "## Outputs", "")
          for (const artifact of taskArtifacts) {
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

      const headingLevel = isTask ? 3 : 2
      if (root) sections.push(messageToMarkdown(root, headingLevel))
      for (const message of orderedMessages) {
        sections.push("", messageToMarkdown(message, headingLevel))
      }

      await navigator.clipboard.writeText(sections.join("\n").trim())
      if (actionsMenuTriggerRef.current) {
        anchoredToastManager.add({
          data: { tooltipStyle: true },
          id: `copy-${isTask ? "task" : "thread"}-markdown`,
          positionerProps: {
            anchor: actionsMenuTriggerRef.current,
            sideOffset: 6,
          },
          timeout: 1800,
          title: `${isTask ? "Task" : "Thread"} copied`,
        })
      }
    } catch {
      toast.error(`Couldn't copy ${isTask ? "task" : "thread"}`)
    }
  }, [fetchThreadPage, isTask, messages, rootMessage, task, taskArtifacts])

  // Files the team fed the task, gathered from the loaded slice of the
  // thread (sources ≠ outputs: uploads stay plain links, artifacts open the
  // viewer).
  const taskSources = useMemo<TaskSourceFile[]>(() => {
    if (!isTask) return []
    const seen = new Map<string, TaskSourceFile>()
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
  }, [isTask, rootMessage, messages])

  // Opening a thread mid-run replays the durable trace into the thread cache.
  useMerlinRunReplay({
    queryClient,
    channelId: view.channelId,
    messages: rootMessage ? [rootMessage, ...messages] : messages,
  })

  // Messages queued behind the active run — surfaced above the composer with
  // steer/remove actions while Merlin is working.
  const pendingMerlinMessage = useMemo(
    () => messages.find((message) => message.status === "pending"),
    [messages]
  )
  const pendingMerlinMessageId = pendingMerlinMessage?.id
  const stopMerlin = useStopMerlinRun()
  const { queuedIds, addOptimistic, removeOptimistic } = useRunQueue({
    socket,
    channelId: view.channelId,
    threadRootId: view.threadRootId,
    pendingMerlinMessageId,
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

  const { data: workspaceMembersData } = useQuery({
    queryKey: ["workspace-members", view.workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: view.workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
  })

  // Same key as the channel route — usually a cache hit; the audience gates
  // which broadcast mentions the composer offers.
  const { data: channelData } = useQuery({
    queryKey: ["channel", view.workspaceSlug, view.channelId],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$get({
        param: {
          workspaceSlug: view.workspaceSlug,
          channelId: view.channelId,
        },
      })
      if (!res.ok) throw new Error("Failed to fetch channel")
      return res.json()
    },
  })

  const mentionCandidates = useMemo(
    () => [
      ...broadcastMentionCandidates(channelData?.audience),
      ...(workspaceMembersData?.members.map((member) => ({
        id: member.userId,
        label: member.displayUsername ?? member.username ?? member.name,
        name: member.name,
        username: member.username,
        displayUsername: member.displayUsername,
        image: member.image,
      })) ?? []),
    ],
    [workspaceMembersData?.members, channelData?.audience]
  )

  // Threads render top-down (oldest → newest). The API + cache hold
  // newest-first, so reverse for display.
  // Queued messages live only in the composer's queue pill until the drain
  // releases them — the transcript skips them (Codex model).
  const orderedReplies = useMemo(
    () => [...messages].reverse().filter((m) => !queuedIds.includes(m.id)),
    [messages, queuedIds]
  )
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
        .map((message) => message.merlinTriggerMessageId)
        .filter((id): id is string => Boolean(id))
    )
  }
  const openingMerlinTriggerMessageIds = openingAnchorsRef.current.messageIds

  const scrollRef = useRef<HTMLDivElement>(null)
  const {
    commandRef: messageScrollCommandRef,
    register: registerScrollCommand,
    scrollToEndRef,
    registerScrollToEnd,
  } = useRegisteredMessageScroller()
  const [sendScrollVersion, setSendScrollVersion] = useState(0)
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
            behavior: "smooth",
          }) ?? false
        if (didScroll) {
          window.requestAnimationFrame(() =>
            highlightMessage(messageId, scrollRef.current ?? document)
          )
        }
        return didScroll
      }

      if (scrollToTarget()) return
      void ensureMessage(messageId)
        .then((loaded) => {
          if (!loaded) return
          window.requestAnimationFrame(scrollToTarget)
        })
        .catch(() => toast.error("Couldn't load that message"))
    },
    [ensureMessage, messageScrollCommandRef]
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
  const showDivider =
    !isLoading &&
    orderedReplies.length > 0 &&
    dividerCount !== undefined &&
    dividerCount > 0

  return (
    <div
      {...getRootProps()}
      className="@container relative flex h-full w-full flex-col"
    >
      <DropZoneOverlay isDragActive={isDragActive} />
      <RightPanelHeader
        title={isTask ? "Task" : "Thread"}
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        titleAdornment={
          taskStatusMeta ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
              <HugeiconsIcon
                icon={taskStatusMeta.icon}
                size={14}
                className={
                  taskStatusMeta.spin
                    ? "animate-spin text-primary"
                    : "text-primary"
                }
              />
              {taskStatusMeta.label}
            </span>
          ) : undefined
        }
        className={isTask ? "border-b-0" : undefined}
        actions={
          <>
            <ThreadSubscriberStack subscribers={participants} />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    ref={actionsMenuTriggerRef}
                    type="button"
                    aria-label={`${isTask ? "Task" : "Thread"} actions`}
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
                <DropdownMenuItem onClick={handleViewInChannel}>
                  <HugeiconsIcon icon={CornerUpRightIcon} strokeWidth={2} />
                  Go to message
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleCopyAsMarkdown()}>
                  <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                  {`Copy ${isTask ? "task" : "thread"} as Markdown`}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {isTask && (
        <TaskThreadHeader
          channelId={view.channelId}
          cardMessageId={view.threadRootId}
          sources={taskSources}
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
              aria-busy={Boolean(pendingMerlinMessage)}
              className="justify-end"
            >
              {rootMessageForRender && (
                <MessageScrollerItem
                  messageId={rootMessageForRender.id}
                  scrollAnchor={openingMerlinTriggerMessageIds.has(
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
                    showMerlinRunControls={false}
                  />
                </MessageScrollerItem>
              )}

              {showDivider && (
                <MessageScrollerItem>
                  <div className="flex items-center gap-3 px-4 pt-3 pb-1 text-[12px] text-muted-foreground">
                    <span className="font-medium">
                      {dividerCount} {dividerCount === 1 ? "reply" : "replies"}
                    </span>
                    <div className="h-px flex-1 bg-border/60" />
                  </div>
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

              {isLoading && orderedReplies.length === 0 ? (
                <MessageScrollerItem className="flex flex-col py-2">
                  {THREAD_SKELETON_GROUPS.map((group) => (
                    <div key={group.key} className="px-4 py-1">
                      <div className="flex gap-3">
                        <Skeleton className="mt-0.5 size-9 shrink-0 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <div className="flex items-baseline gap-2">
                            <Skeleton
                              className="h-3 rounded"
                              style={{ width: group.nameWidth }}
                            />
                            <Skeleton className="h-2.5 w-10 rounded" />
                          </div>
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
                  const showHeader =
                    isDateBoundary ||
                    !prev ||
                    prev.authorId !== msg.authorId ||
                    !isWithinGroupWindow
                  return (
                    <MessageScrollerItem
                      key={msg.id}
                      messageId={msg.id}
                      scrollAnchor={openingMerlinTriggerMessageIds.has(msg.id)}
                    >
                      <MessageItem
                        message={msg}
                        showHeader={showHeader}
                        wrapContentAroundAvatar
                        currentUserId={currentUserId}
                        isReplyTarget={replyingTo?.id === msg.id}
                        onReact={handleReact}
                        onReply={setReplyingTo}
                        onDelete={handleDelete}
                        onEdit={handleEdit}
                        onJumpToMessage={handleJumpWithinThread}
                        mentionCandidates={mentionCandidates}
                        showMerlinRunControls={false}
                      />
                    </MessageScrollerItem>
                  )
                })
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerJumpToLatest
            newestMessageId={
              orderedReplies.at(-1)?.id ?? rootMessage?.id ?? null
            }
            viewportRef={scrollRef}
            isMerlinResponding={Boolean(pendingMerlinMessage)}
          />
        </MessageScroller>

        <div className="shrink-0 pt-2">
          <TypingIndicator users={typingUsers} />
          <RunQueuePill
            messages={queuedMessages}
            currentUserId={currentUserId}
            pendingNonces={pendingNonces}
            onSteer={queuedMessageSteering.steerMessage}
            steeringMessageId={queuedMessageSteering.steeringMessageId}
          />
          <MessageInput
            key={view.threadRootId}
            composerDraft={view.composerDraft}
            onComposerDraftConsumed={consumeComposerDraft}
            context={channelContext}
            channelId={view.channelId}
            contextScopeKey={view.threadRootId}
            placeholder="Reply…"
            onSend={(content, options) => {
              const nonce = handleSend(content, options)
              // Retire opening anchors so a later resize cannot recapture them.
              openingAnchorsRef.current.messageIds.clear()
              scrollToEndRef.current?.({ behavior: "auto" })
              setSendScrollVersion((version) => version + 1)
              // Merlin is mid-answer in this thread, so the reply will queue —
              // show it in the pill immediately instead of waiting for the
              // routed round trip.
              if (nonce && pendingMerlinMessageId) addOptimistic(nonce)
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
              pendingMerlinMessage
                ? () => stopMerlin.mutate(pendingMerlinMessage)
                : undefined
            }
            isStopping={
              stopMerlin.isPending ||
              Boolean(pendingMerlinMessage?.stopRequested)
            }
            canSteerQueued={queuedMessageSteering.canSteerLatestOwnMessage}
            onSteerQueued={queuedMessageSteering.steerLatestOwnMessage}
            isSteeringQueued={queuedMessageSteering.isSteering}
          />
        </div>
      </MessageScrollerProvider>
    </div>
  )
}
