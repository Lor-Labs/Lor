import { authClient } from "@repo/auth/client"
import { LOR_USER_ID } from "@repo/db/constants"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@repo/ui/components/message-scroller"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useDropzone } from "react-dropzone"
import { MessageInput } from "@/components/chat/composer/message-input"
import { ConversationMessages } from "@/components/chat/conversation-messages"
import { DropZoneOverlay } from "@/components/chat/drop-zone-overlay"
import { ForwardDialog } from "@/components/chat/forward-dialog"
import {
  jumpScrollBehavior,
  MessageScrollerCommandBridge,
  MessageScrollerJumpToLatest,
} from "@/components/chat/message-scroller-controls"
import { RunQueuePill } from "@/components/chat/run-queue-pill"
import { DocumentTypingIndicator } from "@/components/chat/typing-indicator"
import { SessionTurnRail } from "@/components/session/session-turn-rail"
import { UserAvatar } from "@/components/ui/user-avatar"
import { useSocket } from "@/context/socket-context"
import { cachedSessionForThread } from "@/hooks/use-agent-session"
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
import { useReplyState } from "@/hooks/use-reply-state"
import {
  dropOptimisticLorTurns,
  type FetchPageParams,
  fetchThreadPage,
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

// How long a local Lor turn waits for the server's before it goes.
const LOR_TURN_TIMEOUT_MS = 20_000

const CHANNEL_CONTEXT = { type: "channel" as const, name: "thread" }

// A Lor session in the main area: its thread read top-down like a document,
// with the input line as the document's last line and the composer's tools
// in a bar under the scroller. Context, plan and files live in the rail.
export function SessionDocument({
  workspaceSlug,
  channelId,
  threadRootId,
  targetMessageId,
  header,
  heading,
  archivedBar,
  cover,
  onFork,
}: {
  workspaceSlug: string
  channelId: string
  threadRootId: string
  // "Fork from here" on Lor's finished replies.
  onFork?: (message: Message) => void
  // Message to center and highlight on open (search result, citation).
  targetMessageId?: string
  // headingVisible: the header shows the title once the heading is gone.
  header: (state: { lorRunning: boolean; headingVisible: boolean }) => ReactNode
  // Opens the document (title and context line); shows once the oldest page
  // is loaded, so it scrolls with the transcript.
  heading?: ReactNode
  // An archived session is read-only: this replaces its input line and tools.
  archivedBar?: ReactNode
  // A code session's open tab (a file or diff): covers the transcript and the
  // composer, which stay mounted so the scroll position and draft survive.
  cover?: ReactNode
}) {
  const queryClient = useQueryClient()
  const socket = useSocket()
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user.id
  const target = { workspaceSlug, channelId, threadRootId }

  const fetchPage = useCallback(
    (params: FetchPageParams) =>
      fetchThreadPage({ workspaceSlug, channelId, threadRootId }, params),
    [workspaceSlug, channelId, threadRootId]
  )

  // Latest-ref indirection: the run queue mounts below (it needs the thread
  // messages), but a failed send must drop the nonce it mirrored there.
  const removeQueuedOptimisticRef = useRef<(id: string) => void>(() => {})
  const undoSendRef = useRef<(nonce: string) => void>(() => {})
  const { data: channel } = useQuery(
    channelQueryOptions(workspaceSlug, channelId)
  )
  // The message being forwarded into the channel chat.
  const [forwarding, setForwarding] = useState<Message | null>(null)
  const { handleSend, pendingNonces } = useMessageSending({
    socket,
    queryClient,
    channelId,
    currentUser: session?.user,
    threadRootId,
    onSendFailed: (nonce) => {
      removeQueuedOptimisticRef.current(nonce)
      undoSendRef.current(nonce)
    },
  })

  const {
    messages,
    root: rootMessage,
    participants,
    isLoading,
    fetchOlder,
    hasOlder,
    isFetchingOlder,
    ensureMessage,
  } = useThreadMessages({
    channelId,
    threadRootId,
    fetchPage,
    socket,
    pendingNoncesRef: pendingNonces,
  })

  // An open session is being read: advance its read cursor on open and on
  // every reply that lands while it's visible. Status too, so a Lor reply
  // finishing while open doesn't leave the sidebar row unread.
  const markThreadRead = useMarkThreadRead(workspaceSlug, channelId)
  const newestReplyKey = messages[0]
    ? `${messages[0].id}:${messages[0].status}`
    : null
  useEffect(() => {
    if (document.visibilityState !== "visible") return
    const timer = setTimeout(() => markThreadRead(threadRootId), 500)
    return () => clearTimeout(timer)
  }, [threadRootId, newestReplyKey, markThreadRead])
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") markThreadRead(threadRootId)
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [threadRootId, markThreadRead])

  const lorRun = useLorRunControls({
    socket,
    queryClient,
    channelId,
    threadRootId,
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
    channelId,
    threadRootId,
    currentUserId,
    currentUserName: session?.user.name,
  })
  const { handleDelete } = useMessageDeletion({
    socket,
    queryClient,
    channelId,
    threadRootId,
  })
  const { handleEdit } = useMessageEditing({
    socket,
    queryClient,
    channelId,
    threadRootId,
  })

  const fileUpload = useFileUpload(channelId)
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) void fileUpload.addFiles(acceptedFiles)
    },
    [fileUpload.addFiles]
  )
  const { getRootProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    noDrag: Boolean(cover),
  })

  const { typingUsers, emitTyping } = useTypingIndicator({
    socket,
    channelId,
    currentUserId,
    threadRootId,
  })
  const { replyingTo, setReplyingTo, clearReply } = useReplyState()
  const mentionCandidates = useMentionCandidates(workspaceSlug, channelId, {
    broadcasts: false,
  })
  const channelPeople = useChannelPeople(workspaceSlug, channelId)

  // Local Lor turns by the nonce of the send that showed them.
  const lorTurnsRef = useRef(new Map<string, string>())
  // What a send changes before the server answers. The writer and the people
  // they mention join the subscribers (and the writer's sidebar gets the
  // session). A follow-up to an idle Lor shows Lor working: its turn, Stop
  // and the sidebar spinner.
  const showSendEffects = (
    nonce: string,
    options?: { mentions: Message["mentions"]; toPeople?: boolean }
  ) => {
    const mentions = options?.mentions ?? []
    const wasSubscribed =
      queryClient
        .getQueryData<ThreadSubscriber[]>(threadSubscribersKey(threadRootId))
        ?.some((person) => person.id === currentUserId) ?? true
    const ids = new Set([currentUserId, ...mentions.map((m) => m.id)])
    showWriteSubscribers(
      queryClient,
      threadRootId,
      channelPeople
        .filter((person) => ids.has(person.userId))
        .map((person) => ({
          id: person.userId,
          name: person.name,
          image: person.image,
          avatarColor: person.avatarColor,
        }))
    )
    const agentSession = cachedSessionForThread(queryClient, threadRootId)
    if (!agentSession || agentSession.archivedAt) return
    const toLor = !options?.toPeople && !pendingLorMessage
    if (toLor) {
      const lorAuthor = messages.find((m) => m.authorId === LOR_USER_ID)
        ?.author ?? { id: LOR_USER_ID, name: "Lor", image: null }
      const turnId = showOptimisticLorTurn(queryClient, threadRootId, {
        nonce,
        channelId,
        lorAuthor,
      })
      lorTurnsRef.current.set(nonce, turnId)
      // Nothing came back (a lost event): the refetched thread decides.
      setTimeout(
        () => dropOptimisticLorTurns(queryClient, threadRootId, turnId),
        LOR_TURN_TIMEOUT_MS
      )
    }
    const sidebarTarget = {
      workspaceId: agentSession.workspaceId,
      channelId: agentSession.channelId,
      sessionId: agentSession.id,
    }
    void cancelSidebarFetch(queryClient, agentSession.workspaceId).then(() => {
      if (!wasSubscribed) {
        patchSidebarSession(queryClient, sidebarTarget, {
          show: sidebarRowFor(agentSession),
        })
      }
      if (toLor) {
        patchSidebarSession(queryClient, sidebarTarget, {
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
        dropOptimisticLorTurns(queryClient, threadRootId, turnId)
      }
      void queryClient.invalidateQueries({
        queryKey: threadSubscribersKey(threadRootId),
      })
      const agentSession = cachedSessionForThread(queryClient, threadRootId)
      if (agentSession) {
        settleSidebarSessions(queryClient, agentSession.workspaceId)
      }
    }
  }, [queryClient, threadRootId])

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
  // Who a message "To subscribers" reaches, shown as faces in the composer.
  const { data: subscribers } = useQuery(threadSubscribersQueryOptions(target))
  const otherSubscribers = useMemo(
    () => subscribers?.filter((person) => person.id !== currentUserId),
    [subscribers, currentUserId]
  )

  // Oldest first for display. Queued messages live only in the composer's
  // queue pill until the drain releases them.
  const orderedReplies = useMemo(
    () => [...messages].reverse().filter((m) => !queuedIds.includes(m.id)),
    [messages, queuedIds]
  )
  // First load: the skeleton shows and the input line waits.
  const isAwaitingReplies = isLoading && orderedReplies.length === 0
  const scroll = useConversationScroll({
    threadRootId,
    targetMessageId,
    messages,
    isLoading,
    ensureMessage,
  })
  const { scrollRef, scrollToEndRef } = scroll
  // The bar under the document the inline composer's tools render into.
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(
    null
  )

  // The heading renders once the oldest page is loaded; until then, and once
  // it scrolls away, the header carries the title.
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
  }, [headingElement, hasOlder, scrollRef])

  const composer = (
    <>
      <RunQueuePill
        messages={queuedMessages}
        currentUserId={currentUserId}
        pendingNonces={pendingNonces}
        onSteer={lorRun.steering.steerMessage}
        steeringMessageId={lorRun.steering.steeringMessageId}
        variant="document"
      />
      {/* Right above the reply line, like other people's draft lines. */}
      <DocumentTypingIndicator people={typingPeople} />
      <MessageInput
        key={threadRootId}
        context={CHANNEL_CONTEXT}
        channelId={channelId}
        contextScopeKey={threadRootId}
        placeholder="Reply…"
        destination="session"
        subscribers={otherSubscribers}
        variant="inline"
        toolbarTarget={toolbarTarget}
        onTypeToFocus={
          cover
            ? undefined
            : () => scrollToEndRef.current?.({ behavior: jumpScrollBehavior() })
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
        onSend={(content, options) => {
          const nonce = handleSend(content, options)
          if (nonce) showSendEffects(nonce, options)
          scroll.scrollAfterSend()
          // Lor is mid-answer, so a message for Lor will queue — show it in
          // the pill now instead of waiting for the routed round trip.
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
      <ForwardDialog
        message={forwarding}
        workspaceSlug={workspaceSlug}
        target={{ channelId, channelName: channel?.name ?? "channel" }}
        onClose={() => setForwarding(null)}
      />
      {header({ lorRunning: Boolean(pendingLorMessage), headingVisible })}

      <MessageScrollerProvider
        key={threadRootId}
        autoScroll
        defaultScrollPosition="last-anchor"
        scrollEdgeThreshold={64}
        scrollPreviousItemPeek={64}
      >
        <MessageScrollerCommandBridge
          register={scroll.registerScrollCommand}
          registerScrollToEnd={scroll.registerScrollToEnd}
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            inert={Boolean(cover)}
            className={cn("flex min-h-0 flex-1 flex-col", cover && "invisible")}
          >
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport
                ref={scrollRef}
                onPointerDown={scroll.onReaderPointerDown}
                reconcileFollowOutput
                followOutputThreshold={64}
                className="[overflow-anchor:none]"
                aria-label="Session messages"
              >
                <MessageScrollerContent
                  aria-busy={Boolean(pendingLorMessage)}
                  className="mx-auto w-full max-w-3xl pt-4"
                >
                  {heading && !hasOlder && (
                    <MessageScrollerItem className="px-4 pt-6 pb-3">
                      <div ref={setHeadingElement}>{heading}</div>
                    </MessageScrollerItem>
                  )}
                  <ConversationMessages
                    layout="document"
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
                      onForward: setForwarding,
                      onFork,
                    }}
                  />
                  {/* Inline input line: the document's last line, reached by
                  scrolling to the end like any document (never pinned). */}
                  {!archivedBar && !isAwaitingReplies && (
                    <div className="pt-3">{composer}</div>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerJumpToLatest
                newestMessageId={
                  orderedReplies.at(-1)?.id ?? rootMessage?.id ?? null
                }
                viewportRef={scrollRef}
                isLorResponding={Boolean(pendingLorMessage)}
              />
              <SessionTurnRail messages={orderedReplies} />
            </MessageScroller>

            {archivedBar ? (
              <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 pb-3">
                {archivedBar}
              </div>
            ) : (
              <div
                ref={setToolbarTarget}
                className="mx-auto w-full max-w-3xl shrink-0 px-4 py-2"
              />
            )}
          </div>
          {cover && <div className="absolute inset-0">{cover}</div>}
        </div>
      </MessageScrollerProvider>
    </div>
  )
}
