import { Archive02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { toast } from "@repo/ui/components/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { AnimatePresence } from "framer-motion"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { useDropzone } from "react-dropzone"
import { ArtifactOverlay } from "@/components/artifacts/artifact-overlay"
import { ChatSkeleton } from "@/components/chat/chat-skeleton"
import { MessageInput } from "@/components/chat/composer/message-input"
import { DropZoneOverlay } from "@/components/chat/drop-zone-overlay"
import { ChatHeader } from "@/components/chat/header"
import {
  MessageList,
  pinMessageForPanelReflow,
  scrollToMessage,
} from "@/components/chat/message-list"
import { RunQueuePill } from "@/components/chat/run-queue-pill"
import { TypingIndicator } from "@/components/chat/typing-indicator"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { VoiceChannelView } from "@/components/voice/voice-channel-view"
import { useSocket } from "@/context/socket-context"
import { useChannelApprovals } from "@/hooks/use-approvals"
import { useAutoMarkRead } from "@/hooks/use-auto-mark-read"
import { useChannelEntry } from "@/hooks/use-channel-entry"
import { useChannelFilesRealtime } from "@/hooks/use-channel-files"
import { useChannelMessages } from "@/hooks/use-channel-messages"
import { useChannelPlans } from "@/hooks/use-channel-plans"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useLorRunReplay } from "@/hooks/use-lor-stream"
import { useMarkThreadRead } from "@/hooks/use-mark-thread-read"
import { useMentionCandidates } from "@/hooks/use-mention-candidates"
import { useMessageDeletion } from "@/hooks/use-message-deletion"
import { useMessageEditing } from "@/hooks/use-message-editing"
import { useMessagePinning } from "@/hooks/use-message-pinning"
import { useMessageReactions } from "@/hooks/use-message-reactions"
import { useMessageIdNavigation } from "@/hooks/use-message-search-navigation"
import { useMessageSending } from "@/hooks/use-message-sending"
import { useChannelProposals } from "@/hooks/use-proposals"
import { useQueuedMessageSteering } from "@/hooks/use-queued-message-steering"
import { useRealtimeRoom } from "@/hooks/use-realtime-room"
import { useReplyState } from "@/hooks/use-reply-state"
import { useRunQueue } from "@/hooks/use-run-queue"
import { useThreadActivity } from "@/hooks/use-thread-activity"
import { useThreadPanelUrlSync } from "@/hooks/use-thread-panel-url-sync"
import { useTypingIndicator } from "@/hooks/use-typing-indicator"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"
import { channelQueryOptions } from "@/lib/channel-query"
import { writeLastChannelId } from "@/lib/last-location"
import { canPinMessages } from "@/lib/permissions"

type ChannelSearchParams = {
  msgId?: string
  // Persists the open thread so a refresh reopens the right-panel thread.
  threadId?: string
  // Focuses a reply inside the open thread (for search/deep links).
  threadMessageId?: string
  // Opens a call's transcript at this moment (ms into the call), e.g. from a
  // Lor [[call:…]] citation. Needs threadId (the call's chat root).
  callAt?: number
  // Opens the artifact viewer; shareable — everyone opening the same URL
  // lands on the same artifact (and, later, in the same live session).
  artifactId?: string
  artifactFrom?: "files"
  fileSearch?: string
  // Prefills the composer with "@Lor <draft>" without sending (setup's Ask
  // Lor suggestions). Cleared once applied.
  draft?: string
}

export const Route = createFileRoute(
  "/_authenticated/$workspaceSlug/$channelId"
)({
  component: ChannelRoute,
  validateSearch: (search: Record<string, unknown>): ChannelSearchParams => ({
    msgId: typeof search.msgId === "string" ? search.msgId : undefined,
    threadId: typeof search.threadId === "string" ? search.threadId : undefined,
    threadMessageId:
      typeof search.threadMessageId === "string"
        ? search.threadMessageId
        : undefined,
    callAt:
      typeof search.callAt === "number" &&
      Number.isFinite(search.callAt) &&
      search.callAt >= 0
        ? search.callAt
        : undefined,
    artifactId:
      typeof search.artifactId === "string" ? search.artifactId : undefined,
    artifactFrom: search.artifactFrom === "files" ? "files" : undefined,
    fileSearch:
      typeof search.fileSearch === "string"
        ? search.fileSearch.slice(0, 200)
        : undefined,
    draft:
      typeof search.draft === "string" ? search.draft.slice(0, 500) : undefined,
  }),
})

// Text channels render immediately so messages load in parallel with the
// channel fetch; voice channels swap in once the type is known.
function ChannelRoute() {
  const { workspaceSlug, channelId } = Route.useParams()
  const { threadId, threadMessageId, callAt } = Route.useSearch()
  const { data } = useQuery(channelQueryOptions(workspaceSlug, channelId))

  if (data?.type === "voice") {
    return (
      <VoiceChannelView
        key={channelId}
        workspaceSlug={workspaceSlug}
        workspaceId={data.workspaceId ?? undefined}
        channelId={channelId}
        channelName={data.name ?? "Voice"}
        archived={Boolean(data.archivedAt)}
        threadId={threadId}
        threadMessageId={threadMessageId}
        callAt={callAt}
      />
    )
  }
  return <ChannelView />
}

function ChannelView() {
  const { workspaceSlug, channelId } = Route.useParams()
  const {
    msgId,
    threadId,
    threadMessageId,
    artifactId,
    artifactFrom,
    fileSearch,
    draft,
  } = Route.useSearch()
  const navigate = Route.useNavigate()
  const composerDraft = useMemo(
    () => (draft ? { id: draft, text: draft } : undefined),
    [draft]
  )
  const consumeComposerDraft = useCallback(() => {
    void navigate({
      search: (prev) => ({ ...prev, draft: undefined }),
      replace: true,
    })
  }, [navigate])
  const socket = useSocket()
  const entry = useChannelEntry(workspaceSlug, channelId)
  useAutoMarkRead(entry.ready ? channelId : undefined)
  const queryClient = useQueryClient()
  const { view, setView, isCollapsed, toggleCollapsed, panelWidth } =
    useRightSidebar()
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user.id
  // Live source for every approval and proposal card in this channel (message
  // cards read the same caches); the socket handlers live here, once per
  // channel view.
  useChannelApprovals(channelId)
  useChannelProposals(channelId)
  // Plans too — cards mount/unmount with scrolling, so without a route-level
  // subscription a terminal plan:updated can arrive with no listener and the
  // card spins on "running" until a refetch.
  useChannelPlans(channelId)
  useChannelFilesRealtime(channelId)

  useEffect(() => {
    if (!workspaceSlug || !channelId) return
    writeLastChannelId(workspaceSlug, channelId)
  }, [workspaceSlug, channelId])

  useThreadPanelUrlSync({ workspaceSlug, channelId, threadId, threadMessageId })

  const { data, isPending, isError, error } = useQuery(
    channelQueryOptions(workspaceSlug, channelId)
  )

  const fetchMessagesPage = useCallback(
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
      ].messages.$get({
        param: { workspaceSlug, channelId },
        query,
      })
      if (!res.ok) throw new Error("Failed to fetch messages")
      return res.json()
    },
    [workspaceSlug, channelId]
  )

  const { handleSend, pendingNonces } = useMessageSending({
    socket,
    queryClient,
    channelId,
    currentUser: session?.user,
    // Interim until the composer's "Started · Open" note (runbook Step 7).
    onSessionStarted: (started) =>
      toast("Session started", {
        description: started.title,
        action: {
          label: "Open",
          onClick: () =>
            void navigate({
              to: "/$workspaceSlug/session/$sessionId",
              params: { workspaceSlug, sessionId: started.id },
            }),
        },
      }),
  })

  const {
    messages,
    isLoading: messagesLoading,
    isAnchorMissing,
    fetchOlder,
    fetchNewer,
    hasOlder,
    hasNewer,
    isFetchingOlder,
    isFetchingNewer,
    isAtPresent,
    pendingCount,
    clearPending,
  } = useChannelMessages({
    channelId,
    anchor: msgId ?? entry.anchor,
    anchorReady: Boolean(msgId) || entry.ready,
    fetchPage: fetchMessagesPage,
    enabled: !!data,
    socket,
    pendingNoncesRef: pendingNonces,
  })

  useEffect(() => {
    // The entry message can be deleted between resolving it and loading history.
    if (entry.anchor && !msgId && isAnchorMissing) {
      entry.jumpToPresent()
    }
  }, [entry.anchor, entry.jumpToPresent, msgId, isAnchorMissing])

  const handleJumpToPresent = useCallback(() => {
    entry.jumpToPresent()
    clearPending()
    void navigate({ search: {}, replace: true })
  }, [clearPending, navigate, entry.jumpToPresent])

  // Resolve the message's channel and thread (it may live elsewhere — e.g. a
  // Lor citation to another channel or a thread reply) and navigate there.
  const navigateToMessageId = useMessageIdNavigation()
  const handleJumpToMessage = useCallback(
    (messageId: string) => {
      void navigateToMessageId(messageId).then(
        (found) => {
          if (!found) void navigate({ search: { msgId: messageId } })
        },
        () => toast.error("Couldn't load that message")
      )
    },
    [navigate, navigateToMessageId]
  )

  const handleOpenThread = useCallback(
    (rootMessageId: string) => {
      setView({
        type: "thread",
        workspaceSlug,
        channelId,
        threadRootId: rootMessageId,
      })
      if (isCollapsed) toggleCollapsed()
    },
    [setView, workspaceSlug, channelId, isCollapsed, toggleCollapsed]
  )

  // Opening, closing, or collapsing the thread panel animates the channel
  // width, re-wrapping every message row. Pin the thread's root message (the
  // card the user is working with) through that reflow so it stays put on
  // screen. Gate on the panel's effective width: switching between threads
  // keeps the panel where it is, so pinning there would only yank the scroller
  // out of follow-output. Layout effect: the pin must start before the first
  // animation frame.
  const openThreadRootRef = useRef<string | null>(null)
  const panelReflowWidthRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    const currentRoot =
      view?.type === "thread" && !isCollapsed ? view.threadRootId : null
    const previousRoot = openThreadRootRef.current
    openThreadRootRef.current = currentRoot
    const effectiveWidth = view && !isCollapsed ? panelWidth : 0
    const previousWidth = panelReflowWidthRef.current
    panelReflowWidthRef.current = effectiveWidth
    if (previousWidth === null || previousWidth === effectiveWidth) return
    const anchorRoot = previousRoot ?? currentRoot
    if (anchorRoot) pinMessageForPanelReflow(anchorRoot)
  }, [view, isCollapsed, panelWidth])

  // MessageItem is memoized — forward a stable callback identity so route
  // re-renders don't re-render every message row.
  const handleReplyInThread = useCallback(
    (msg: Message) => handleOpenThread(msg.id),
    [handleOpenThread]
  )

  const { data: workspaceMembersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
  })

  useRealtimeRoom(socket, "channel", channelId)

  const { handleReact } = useMessageReactions({
    socket,
    queryClient,
    channelId,
    currentUserId,
    currentUserName: session?.user.name,
  })

  const { handleDelete } = useMessageDeletion({
    socket,
    queryClient,
    channelId,
  })

  const { handleEdit } = useMessageEditing({
    socket,
    queryClient,
    channelId,
  })

  useLorRunReplay({ queryClient, channelId, messages })

  // Channel-scope queue (a send can land while a run is finalizing) —
  // surfaced in the same composer pill as thread queues.
  const pendingLorMessageId = useMemo(
    () => messages.find((m) => m.status === "pending")?.id,
    [messages]
  )
  const { queuedIds } = useRunQueue({
    socket,
    channelId,
    threadRootId: null,
    pendingLorMessageId,
  })
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
  // Queued messages live only in the composer's queue pill until the drain
  // releases them — the transcript skips them (Codex model).
  const visibleMessages = useMemo(
    () => messages.filter((m) => !queuedIds.includes(m.id)),
    [messages, queuedIds]
  )

  const { data: activeMember } = useQuery({
    queryKey: ["active-workspace-member", workspaceSlug],
    queryFn: async () => {
      const res = await authClient.organization.getActiveMember()
      if (res.error) return null
      return res.data
    },
  })

  const activeMemberCtx =
    typeof activeMember?.role === "string" &&
    typeof activeMember.userId === "string" &&
    workspaceMembersData?.ownerId
      ? {
          actor: { userId: activeMember.userId, role: activeMember.role },
          workspace: { ownerId: workspaceMembersData.ownerId },
        }
      : null

  const canPin = activeMemberCtx
    ? canPinMessages(activeMemberCtx.actor, activeMemberCtx.workspace)
    : false

  const { handleTogglePin } = useMessagePinning({
    socket,
    queryClient,
    channelId,
    workspaceSlug,
  })

  const { replyingTo, setReplyingTo, clearReply } = useReplyState()

  const { data: threadActivityData } = useQuery({
    queryKey: ["thread-activity", channelId],
    enabled: !!data,
    // Seed on channel open; don't resurrect dismissed cards on tab refocus.
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ]["thread-activity"].$get({
        param: { workspaceSlug, channelId },
      })
      if (!res.ok) throw new Error("Failed to fetch thread activity")
      return res.json()
    },
  })

  // On leaving a channel, drop its cached thread activity so a just-read card
  // doesn't flash on return — the next visit refetches fresh from the server.
  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: ["thread-activity", channelId] })
    }
  }, [channelId, queryClient])

  const threadActivitySeed = useMemo(
    () =>
      threadActivityData?.data.map((item) => ({
        threadRootId: item.threadRootId,
        replyCount: item.replyCount,
        newReplyCount: item.newReplyCount,
        lastReplyAt: item.lastReplyAt,
        participants: item.participants,
        lastReply: {
          content: item.lastReply.content,
          authorName: item.lastReply.author.name,
          hasAttachments: item.lastReply.hasAttachments,
          mentions: item.lastReply.mentions,
        },
      })),
    [threadActivityData]
  )

  const { activities: threadActivities, dismiss: dismissThreadActivity } =
    useThreadActivity({
      socket,
      channelId,
      seed: threadActivitySeed,
      suppressThreadRootId: view?.type === "thread" ? view.threadRootId : null,
    })

  const markThreadRead = useMarkThreadRead(workspaceSlug, channelId)

  const handleOpenThreadActivity = useCallback(
    (threadRootId: string) => {
      handleOpenThread(threadRootId)
      dismissThreadActivity(threadRootId)
      markThreadRead(threadRootId)
      // Bring the root into view in the main feed too, so the thread is seen
      // in its original context. Scroll in place when it's loaded; otherwise
      // anchor the feed on it via ?msgId (the channel refetches around it).
      if (!scrollToMessage(threadRootId)) {
        void navigate({
          search: (prev) => ({ ...prev, msgId: threadRootId }),
        })
      }
    },
    [handleOpenThread, dismissThreadActivity, markThreadRead, navigate]
  )

  const handleDismissThreadActivity = useCallback(
    (threadRootId: string) => {
      dismissThreadActivity(threadRootId)
      markThreadRead(threadRootId)
    },
    [dismissThreadActivity, markThreadRead]
  )

  const { typingUsers, emitTyping } = useTypingIndicator({
    socket,
    channelId,
    currentUserId,
  })

  // Clear reply state when switching channels
  useEffect(() => {
    clearReply()
  }, [channelId, clearReply])

  const fileUpload = useFileUpload(channelId)

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

  const mentionCandidates = useMentionCandidates(workspaceSlug, channelId)

  if (isPending) {
    return <ChatSkeleton />
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Failed to load channel"}
        </span>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">Channel not found</span>
      </div>
    )
  }

  const context = {
    type: "channel" as const,
    name: data.name ?? channelId,
    topic: data.topic ?? undefined,
    // Standalone private channels wear the hash+lock glyph in the header;
    // project channels don't (the project boundary communicates the audience).
    isPrivate: data.audience === "members" && data.parentId === null,
  }

  return (
    <div
      {...getRootProps()}
      className="relative flex h-full flex-col overflow-hidden"
    >
      <DropZoneOverlay isDragActive={isDragActive} />
      <ChatHeader context={context} channelId={channelId} />
      <MessageList
        key={channelId}
        context={context}
        messages={visibleMessages}
        hasOlder={hasOlder}
        onLoadOlder={() => fetchOlder()}
        isFetchingOlder={isFetchingOlder}
        hasNewer={hasNewer}
        onLoadNewer={() => fetchNewer()}
        isFetchingNewer={isFetchingNewer}
        pendingCount={pendingCount}
        onJumpToPresent={isAtPresent ? undefined : handleJumpToPresent}
        scrollTargetId={msgId ?? entry.anchor}
        firstUnreadMessageId={entry.firstUnreadMessageId}
        highlightScrollTarget={Boolean(msgId)}
        onJumpToMessage={handleJumpToMessage}
        onReplyInThread={handleReplyInThread}
        onOpenThread={handleOpenThread}
        threadActivities={threadActivities}
        onOpenThreadActivity={handleOpenThreadActivity}
        onDismissThreadActivity={handleDismissThreadActivity}
        replyingToId={replyingTo?.id ?? null}
        currentUserId={currentUserId}
        onReact={handleReact}
        onReply={setReplyingTo}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onTogglePin={handleTogglePin}
        canPin={canPin}
        mentionCandidates={mentionCandidates}
        isLoading={messagesLoading}
      />
      <TypingIndicator users={typingUsers} />
      <RunQueuePill
        messages={queuedMessages}
        currentUserId={currentUserId}
        pendingNonces={pendingNonces}
        onSteer={queuedMessageSteering.steerMessage}
        steeringMessageId={queuedMessageSteering.steeringMessageId}
      />
      {data.archivedAt ? (
        // Archived: no composer — a terminal divider marks when it closed.
        <div className="px-4 pt-1 pb-5">
          <div className="relative flex items-center">
            <div className="h-px w-full bg-border/70" />
            <span className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              <HugeiconsIcon
                icon={Archive02Icon}
                className="size-3.5 shrink-0"
                strokeWidth={2}
              />
              Archived{" "}
              {new Date(data.archivedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      ) : (
        <MessageInput
          composerDraft={composerDraft}
          onComposerDraftConsumed={consumeComposerDraft}
          lorIntro
          context={context}
          channelId={channelId}
          onSend={handleSend}
          currentUserId={currentUserId}
          mentionCandidates={mentionCandidates}
          replyingTo={replyingTo}
          onCancelReply={clearReply}
          pendingAttachments={fileUpload.attachments}
          addFiles={fileUpload.addFiles}
          removeAttachment={fileUpload.removeAttachment}
          clearAttachments={fileUpload.clearAttachments}
          getUploadedAttachments={fileUpload.getUploadedAttachments}
          isUploading={fileUpload.isUploading}
          onTyping={emitTyping}
          canSteerQueued={queuedMessageSteering.canSteerLatestOwnMessage}
          onSteerQueued={queuedMessageSteering.steerLatestOwnMessage}
          isSteeringQueued={queuedMessageSteering.isSteering}
        />
      )}
      <AnimatePresence>
        {artifactId && (
          <ArtifactOverlay
            key={artifactId}
            artifactId={artifactId}
            closeLabel={
              artifactFrom === "files" ? "Back to artifacts" : undefined
            }
            onClose={() => {
              if (artifactFrom) {
                setView({
                  type: "attachments",
                  kind: "artifact",
                  workspaceSlug,
                  channelId,
                  search: fileSearch,
                })
                if (isCollapsed) toggleCollapsed()
              }
              void navigate({
                search: (prev) => ({
                  ...prev,
                  artifactId: undefined,
                  artifactFrom: undefined,
                  fileSearch: undefined,
                  ...(artifactFrom
                    ? { threadId: undefined, threadMessageId: undefined }
                    : {}),
                }),
                replace: true,
              })
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
