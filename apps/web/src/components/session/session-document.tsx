import { authClient } from "@repo/auth/client"
import { LOR_USER_ID } from "@repo/db/constants"
import type { RealtimeAgentSession } from "@repo/realtime-types"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@repo/ui/components/message-scroller"
import { cn } from "@repo/ui/lib/utils"
import { isHarnessEnabled } from "@repo/utils/features"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  type DragEvent,
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
  MessageScrollerCommandBridge,
  MessageScrollerJumpToLatest,
} from "@/components/chat/message-scroller-controls"
import { RunQueuePill } from "@/components/chat/run-queue-pill"
import { DocumentTypingIndicator } from "@/components/chat/typing-indicator"
import {
  ClaudeCodeModePicker,
  useClaudeCodeMode,
} from "@/components/session/claude-code-mode-picker"
import { EffortPicker, ModelPicker } from "@/components/session/model-picker"
import { SessionTurnRail } from "@/components/session/session-turn-rail"
import { UserAvatar } from "@/components/ui/user-avatar"
import { useSocket } from "@/context/socket-context"
import {
  pinSessionChoice,
  runModelLabel,
  type SessionTurnPick,
  useModelChoice,
} from "@/hooks/use-agent-models"
import {
  cachedSessionForThread,
  sessionTouchesQueryOptions,
} from "@/hooks/use-agent-session"
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
import { useProvideSessionSend } from "@/hooks/use-session-send"
import { useStableCallback } from "@/hooks/use-stable-callback"
import {
  dropOptimisticLorTurns,
  type FetchPageParams,
  fetchThreadPage,
  LOR_TURN_TIMEOUT_MS,
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
import {
  acceptsRepoFileDrag,
  type ComposerFileReference,
  hasRepoFileDrag,
  readRepoFileDrag,
} from "@/lib/repo-file-reference"
import { useSessionComposerInbox } from "@/lib/session-composer-inbox"

const CHANNEL_CONTEXT = { type: "channel" as const, name: "thread" }
// A panel's "Ask Lor" has no draft to resend from: an unanswered send fails.
const PANEL_SEND_ACK_TIMEOUT_MS = 12_000

// A Lor session in the main area: its thread read top-down like a document,
// with the input line as the document's last line and the composer's tools
// in a bar under the scroller. Context, plan and files live in the rail.
export function SessionDocument({
  workspaceSlug,
  channelId,
  threadRootId,
  sessionId,
  targetMessageId,
  header,
  heading,
  archivedBar,
  cover,
  repoSessionId,
  onShowChat,
  onRead,
  onFork,
  onRewind,
  rewindRestoresFiles,
  composerNote,
  harness,
  harnessCommands,
  claudeCode = false,
  withoutSubscription = false,
}: {
  workspaceSlug: string
  channelId: string
  threadRootId: string
  sessionId: string
  harness: RealtimeAgentSession["harness"]
  // Its harness's own commands and skills, for the composer's menus.
  harnessCommands?: RealtimeAgentSession["harnessCommands"]
  // Above the reply line: why the agent won't answer this person (a Claude
  // Code or Codex session without their own plan).
  composerNote?: ReactNode
  // A Claude Code session this person can run turns in: each message carries
  // the Claude Code mode picked in the composer.
  claudeCode?: boolean
  // A Claude Code or Codex session this person has no plan for: their
  // messages go to the session's people.
  withoutSubscription?: boolean
  // "Fork from here" on Lor's finished replies; settles when the fork opens
  // or fails.
  onFork?: (message: Message) => Promise<unknown>
  // "Rewind to here" between turns; unset where the session can't rewind.
  onRewind?: (message: Message) => Promise<unknown>
  // A code session's rewind also puts back the turn's files.
  rewindRestoresFiles?: boolean
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
  repoSessionId?: string
  onShowChat?: () => void
  // The person read the session: the page clears its sidebar unread state.
  onRead?: () => void
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
    // Its Details panel hears about saved touches by thread event.
    alsoRefresh: sessionTouchesQueryOptions(sessionId).queryKey,
  })

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
  const { handleEdit, editLastOwnMessage } = useMessageEditing({
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
  // The server sends a message to the agent only while its harness is on
  // and, in Claude Code and Codex, from someone with their own plan.
  const agentAnswers = isHarnessEnabled(harness) && !withoutSubscription
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
    const toLor = agentAnswers && !options?.toPeople && !pendingLorMessage
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

  // An open session is read while its transcript shows (loaded, not under a
  // code tab): its read cursor advances then, on every reply that lands, and
  // when the transcript is left. Status too, so a Lor reply finishing while
  // open doesn't leave the sidebar row unread.
  const transcriptShown = !cover && !isAwaitingReplies
  const markThreadRead = useMarkThreadRead(
    workspaceSlug,
    channelId,
    transcriptShown ? threadRootId : undefined
  )
  const onReadRef = useRef(onRead)
  onReadRef.current = onRead
  const newestReplyKey = messages[0]
    ? `${messages[0].id}:${messages[0].status}`
    : null
  useEffect(() => {
    if (!transcriptShown || document.visibilityState !== "visible") return
    const timer = setTimeout(() => {
      markThreadRead(threadRootId)
      onReadRef.current?.()
    }, 500)
    return () => clearTimeout(timer)
  }, [threadRootId, newestReplyKey, markThreadRead, transcriptShown])
  useEffect(() => {
    if (!transcriptShown) return
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return
      markThreadRead(threadRootId)
      onReadRef.current?.()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      if (document.visibilityState === "visible") onReadRef.current?.()
    }
  }, [threadRootId, markThreadRead, transcriptShown])
  const scroll = useConversationScroll({
    threadRootId,
    targetMessageId,
    messages,
    isLoading,
    ensureMessage,
  })
  const { scrollRef } = scroll
  const [isRepoDragActive, setIsRepoDragActive] = useState(false)
  const [fileReference, setFileReference] = useState<ComposerFileReference>()
  // The input line, absent while archived or before the first page loads.
  const showInputLine = !archivedBar && !isAwaitingReplies
  // Fix with Lor from a review card or the Details panel's Review list.
  const [composerDraft, setComposerDraft] = useState<{
    id: string
    text: string
    lines: true
  }>()
  useSessionComposerInbox(
    threadRootId,
    (text) => {
      setComposerDraft({ id: crypto.randomUUID(), text, lines: true })
      if (cover) onShowChat?.()
    },
    showInputLine
  )
  const canReferenceFiles = Boolean(
    repoSessionId && !archivedBar && !isAwaitingReplies
  )
  const onRepoDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasRepoFileDrag(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    const accepted =
      canReferenceFiles &&
      acceptsRepoFileDrag(event.dataTransfer, repoSessionId)
    event.dataTransfer.dropEffect = accepted ? "copy" : "none"
    setIsRepoDragActive(accepted)
    if (accepted && cover) onShowChat?.()
  }
  const onRepoDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasRepoFileDrag(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    setIsRepoDragActive(false)
    const reference = readRepoFileDrag(event.dataTransfer)
    if (
      !canReferenceFiles ||
      reference?.sessionId !== repoSessionId ||
      reference?.workspaceSlug !== workspaceSlug
    )
      return
    setFileReference({
      id: crypto.randomUUID(),
      reference,
      point: cover ? undefined : { left: event.clientX, top: event.clientY },
    })
    if (cover) onShowChat?.()
  }
  useEffect(() => {
    const clearDrag = () => setIsRepoDragActive(false)
    window.addEventListener("dragend", clearDrag)
    return () => window.removeEventListener("dragend", clearDrag)
  }, [])
  useEffect(() => {
    setFileReference(undefined)
    setIsRepoDragActive(false)
  }, [repoSessionId])
  // The bar under the document the inline composer's tools render into.
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(
    null
  )
  const claudeMode = useClaudeCodeMode()
  // The session's newest run seeds its picker on a browser that never picked
  // here (LOR-160).
  const lastRun = messages.find(
    (m) => m.authorId === LOR_USER_ID && m.lorRun?.model
  )?.lorRun
  const lastTurnModel = lastRun?.model
  const lastTurnEffort = lastRun?.effort ?? null
  const lastTurnFast = lastRun?.fast ?? false
  const lastTurn = useMemo<SessionTurnPick | null>(
    () =>
      lastTurnModel
        ? { model: lastTurnModel, effort: lastTurnEffort, fast: lastTurnFast }
        : null,
    [lastTurnModel, lastTurnEffort, lastTurnFast]
  )
  const modelChoice = useModelChoice(harness, {
    sessionScope: threadRootId,
    lastTurn,
  })
  const catalog = modelChoice.catalog
  const modelLabel = useCallback(
    (model: string) => runModelLabel(catalog, model),
    [catalog]
  )

  const send = (
    content: string,
    options?: Parameters<typeof handleSend>[1]
  ) => {
    const nonce = handleSend(content, {
      mentions: [],
      ...options,
      ...(agentAnswers ? modelChoice.turn : {}),
      ...(claudeCode ? { claudeCodeMode: claudeMode.mode } : {}),
    })
    if (nonce) showSendEffects(nonce, options)
    if (nonce && agentAnswers) pinSessionChoice(modelChoice)
    scroll.scrollAfterSend()
    // Lor is mid-answer, so a message for Lor will queue — show it in
    // the pill now instead of waiting for the routed round trip.
    if (nonce && pendingLorMessage && !options?.toPeople && agentAnswers) {
      lorRun.addOptimistic(nonce)
    }
    return nonce
  }

  // This page re-renders on every Lor stream frame; with these props stable
  // the memoized composer skips those renders.
  const onComposerSend = useStableCallback(send)
  const onComposerStop = useStableCallback(lorRun.onStop)
  const onComposerSteer = useStableCallback(
    lorRun.steering.steerLatestOwnMessage
  )
  const onComposerDraftConsumed = useCallback(
    (id: string) =>
      setComposerDraft((current) => (current?.id === id ? undefined : current)),
    []
  )
  const onComposerFileReferenceConsumed = useCallback(
    (id: string) =>
      setFileReference((current) => (current?.id === id ? undefined : current)),
    []
  )
  const myAvatarColor = participants.find(
    (person) => person.id === currentUserId
  )?.avatarColor
  const composerGutter = useMemo(
    () => (
      <UserAvatar
        name={session?.user.name}
        src={session?.user.image}
        avatarColor={myAvatarColor}
        size="sm"
        className="size-7"
      />
    ),
    [session?.user.name, session?.user.image, myAvatarColor]
  )
  const composerTools = useMemo(
    () =>
      agentAnswers ? (
        <>
          <ModelPicker choice={modelChoice} />
          <EffortPicker choice={modelChoice} />
          {claudeCode && (
            <ClaudeCodeModePicker
              value={claudeMode.mode}
              onChange={claudeMode.setMode}
            />
          )}
        </>
      ) : undefined,
    [agentAnswers, modelChoice, claudeCode, claudeMode.mode, claudeMode.setMode]
  )

  useProvideSessionSend(threadRootId, (content, onFailed) =>
    Boolean(
      send(content, {
        mentions: [],
        onFailed,
        ackTimeoutMs: PANEL_SEND_ACK_TIMEOUT_MS,
      })
    )
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

  // The input line is sticky inside the transcript scroller. When it grows (a
  // new line, the reply bar) with the reader at the bottom, scroll by as much
  // in the observer callback, before paint: the scroller's own follow runs a
  // frame later, so the line would cover the last message for a frame. Not
  // while a turn is anchored to the top over the scroller's spacer.
  // Pointing at the input line also keeps the transcript's scrollbar hidden
  // (globals.css data-scrollbar-quiet); only the editor's own shows.
  const [inputLineElement, setInputLineElement] =
    useState<HTMLDivElement | null>(null)
  useEffect(() => {
    const line = inputLineElement
    const viewport = scrollRef.current
    if (!line || !viewport) return
    let height = line.offsetHeight
    const observer = new ResizeObserver(() => {
      const grew = line.offsetHeight - height
      height += grew
      if (grew <= 0) return
      const spacer = viewport.querySelector<HTMLElement>(
        "[data-message-scroller-spacer]"
      )
      if (spacer && !spacer.hidden) return
      const fromBottom =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
      if (fromBottom - grew <= 1) viewport.scrollTop += grew
    })
    observer.observe(line)
    const quiet = () => viewport.setAttribute("data-scrollbar-quiet", "")
    const loud = () => viewport.removeAttribute("data-scrollbar-quiet")
    line.addEventListener("pointerenter", quiet)
    line.addEventListener("pointerleave", loud)
    return () => {
      observer.disconnect()
      line.removeEventListener("pointerenter", quiet)
      line.removeEventListener("pointerleave", loud)
      loud()
    }
  }, [inputLineElement, scrollRef])

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
      <DocumentTypingIndicator
        people={typingPeople}
        reserve={Boolean(otherSubscribers?.length)}
      />
      {composerNote}
      <MessageInput
        key={threadRootId}
        draftKey={`thread:${threadRootId}`}
        context={CHANNEL_CONTEXT}
        channelId={channelId}
        contextScopeKey={threadRootId}
        composerFileReference={
          !cover && fileReference?.reference.sessionId === repoSessionId
            ? fileReference
            : undefined
        }
        onComposerFileReferenceConsumed={onComposerFileReferenceConsumed}
        composerDraft={cover ? undefined : composerDraft}
        onComposerDraftConsumed={onComposerDraftConsumed}
        placeholder="Reply…"
        destination="session"
        peopleOnly={!agentAnswers}
        subscribers={otherSubscribers}
        variant="inline"
        toolbarTarget={toolbarTarget}
        typeToFocus={!cover}
        gutter={composerGutter}
        tools={composerTools}
        onShiftTab={claudeCode ? claudeMode.cycle : undefined}
        harnessCommands={agentAnswers ? harnessCommands : null}
        onSend={onComposerSend}
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
        onEditLast={editLastOwnMessage}
        onStop={onComposerStop}
        isStopping={lorRun.isStopping}
        canSteerQueued={lorRun.steering.canSteerLatestOwnMessage}
        onSteerQueued={onComposerSteer}
        isSteeringQueued={lorRun.steering.isSteering}
      />
    </>
  )

  const jumpToLatest = (className?: string) => (
    <MessageScrollerJumpToLatest
      newestMessageId={orderedReplies.at(-1)?.id ?? rootMessage?.id ?? null}
      viewportRef={scrollRef}
      isLorResponding={Boolean(pendingLorMessage)}
      className={className}
    />
  )

  return (
    <div
      {...getRootProps()}
      onDragEnterCapture={onRepoDragOver}
      onDragOverCapture={onRepoDragOver}
      onDragLeaveCapture={(event) => {
        if (!hasRepoFileDrag(event.dataTransfer)) return
        event.stopPropagation()
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setIsRepoDragActive(false)
        }
      }}
      onDropCapture={onRepoDrop}
      className="@container relative flex h-full w-full flex-col"
    >
      <DropZoneOverlay isDragActive={isDragActive} />
      {isRepoDragActive && (
        <div className="pointer-events-none absolute inset-0 z-40 rounded-lg border-2 border-dashed border-primary/40">
          <div className="absolute inset-x-0 bottom-16 flex justify-center">
            <span className="rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm">
              Drop to reference this file or folder
            </span>
          </div>
        </div>
      )}
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
                    pausedLorMessageId={lorRun.pausedLorMessageId}
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
                      onRewind,
                      rewindRestoresFiles,
                      modelLabel,
                    }}
                  />
                  {/* Inline input line: the document's last line, right under
                  the last turn. Sticky, so while you scroll back it stays at
                  the bottom edge (LOR-129), with Jump to latest above it. */}
                  {showInputLine && (
                    <div
                      ref={setInputLineElement}
                      className="sticky bottom-0 z-30 bg-background pt-3"
                    >
                      {jumpToLatest("bottom-full mb-2")}
                      {composer}
                    </div>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              {!showInputLine && jumpToLatest()}
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
