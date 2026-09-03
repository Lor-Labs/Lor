import { HashtagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@repo/ui/components/message-scroller"
import { Skeleton } from "@repo/ui/components/skeleton"
import { Spinner } from "@repo/ui/components/spinner"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { differenceInMinutes, isSameDay } from "@repo/utils/date"
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import { DateDivider } from "@/components/chat/date-divider"
import type { ChatContext } from "@/components/chat/header"
import { MessageItem } from "@/components/chat/message-item"
import {
  highlightMessage,
  type MessageScrollCommand,
  MessageScrollerCommandBridge,
  MessageScrollerJumpToLatest,
  MessageScrollTarget,
  signalMessageScrollerInteraction,
  useRegisteredMessageScroller,
} from "@/components/chat/message-scroller-controls"
import { ThreadActivityDock } from "@/components/chat/thread-activity"
import { PrivateHashIcon } from "@/components/ui/private-hash-icon"
import type { ThreadActivity } from "@/hooks/use-thread-activity"
import type { Message } from "@/lib/api-types"

interface MessageListProps {
  context: ChatContext
  messages: Message[]
  currentUserId?: string
  blockedUserIds?: Set<string>
  onReact?: (messageId: string, emoji: string) => void
  onReply?: (message: Message) => void
  onReplyInThread?: (message: Message) => void
  onOpenThread?: (rootMessageId: string) => void
  replyingToId?: string | null
  onDelete?: (messageId: string) => void
  onEdit?: (messageId: string, content: string) => void
  onTogglePin?: (messageId: string, currentlyPinned: boolean) => void
  canPin?: boolean
  mentionCandidates?: MentionCandidate[]
  isLoading?: boolean
  hasOlder?: boolean
  onLoadOlder?: () => void
  isFetchingOlder?: boolean
  hasNewer?: boolean
  onLoadNewer?: () => void
  isFetchingNewer?: boolean
  /**
   * Number of live messages received while the user is viewing older
   * context. Shown on the Jump-to-present pill so they know how many they're
   * behind on (Discord/Slack pattern).
   */
  pendingCount?: number
  onJumpToPresent?: () => void
  /** Message to center after an anchored/permalink page has mounted. */
  scrollTargetId?: string | null
  /**
   * Clicking a reply preview / citation jumps to the referenced message id.
   * The route translates this into URL-anchor navigation; MessageList just
   * forwards the click.
   */
  onJumpToMessage?: (messageId: string) => void
  /**
   * Fresh thread replies surfaced in the floating dock above the composer.
   * Clicking a blob/card opens the thread (and the parent marks it read).
   */
  threadActivities?: ThreadActivity[]
  onOpenThreadActivity?: (threadRootId: string) => void
  onDismissThreadActivity?: (threadRootId: string) => void
}

function EmptyState({ context }: { context: ChatContext }) {
  return (
    <div className="flex flex-1 flex-col justify-end px-6 pb-4">
      <div className="flex flex-col items-start gap-3">
        {context.type === "channel" ? (
          <div className="flex size-14 items-center justify-center rounded-full bg-accent text-foreground">
            {context.isPrivate ? (
              <PrivateHashIcon className="size-7" strokeWidth={2.25} />
            ) : (
              <HugeiconsIcon
                icon={HashtagIcon}
                className="size-7"
                strokeWidth={2.25}
              />
            )}
          </div>
        ) : (
          <Avatar className="size-14">
            {context.type === "dm" && context.avatarUrl && (
              <AvatarImage src={context.avatarUrl} alt={context.name} />
            )}
            <AvatarFallback
              className="text-lg font-semibold"
              fallbackSeed={context.name}
            >
              {getAvatarInitials(context.name)}
            </AvatarFallback>
          </Avatar>
        )}
        <div>
          <h3 className="text-2xl font-extrabold">
            {context.type === "channel"
              ? `Welcome to #${context.name}!`
              : context.name}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {context.type === "channel"
              ? `This is the start of the #${context.name} channel.`
              : context.type === "dm"
                ? `This is the beginning of your direct message history with ${context.name}.`
                : `This is the beginning of your group conversation.`}
          </p>
        </div>
      </div>
    </div>
  )
}

const MESSAGE_SKELETON_GROUPS = [
  { key: "a", nameWidth: "5rem", lines: ["80%", "45%"] },
  { key: "b", nameWidth: "6.5rem", lines: ["60%"] },
  { key: "c", nameWidth: "4rem", lines: ["90%", "70%", "35%"] },
  { key: "d", nameWidth: "5.5rem", lines: ["50%"] },
  { key: "e", nameWidth: "7rem", lines: ["75%", "55%"] },
  { key: "f", nameWidth: "4.5rem", lines: ["65%"] },
  { key: "g", nameWidth: "6rem", lines: ["85%", "40%"] },
]
const MESSAGE_GROUP_WINDOW_MINUTES = 5

let activeMessageScrollCommand: MessageScrollCommand | null = null

export function scrollToMessage(messageId: string): boolean {
  const didScroll =
    activeMessageScrollCommand?.(messageId, {
      align: "center",
      behavior: "smooth",
    }) ?? false
  if (didScroll) {
    window.requestAnimationFrame(() => highlightMessage(messageId))
  }
  return didScroll
}

export function MessageList({
  context,
  messages,
  currentUserId,
  blockedUserIds,
  onReact,
  onReply,
  onReplyInThread,
  onOpenThread,
  onDelete,
  onEdit,
  onTogglePin,
  canPin,
  mentionCandidates,
  isLoading,
  hasOlder,
  onLoadOlder,
  isFetchingOlder,
  hasNewer,
  onLoadNewer,
  isFetchingNewer,
  pendingCount = 0,
  onJumpToPresent,
  scrollTargetId,
  onJumpToMessage,
  replyingToId,
  threadActivities,
  onOpenThreadActivity,
  onDismissThreadActivity,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const olderSentinelRef = useRef<HTMLDivElement>(null)
  const newerSentinelRef = useRef<HTMLDivElement>(null)
  const stickyDateRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const {
    commandRef: messageScrollCommandRef,
    register: registerScrollCommand,
  } = useRegisteredMessageScroller()
  const ownedCommandRef = useRef<MessageScrollCommand | null>(null)

  const orderedMessages = useMemo(() => [...messages].reverse(), [messages])
  const pendingMerlinMessage = messages.find(
    (message) => message.status === "pending"
  )
  const contentVersion = `${messages.length}:${messages[0]?.id ?? ""}:${messages.at(-1)?.id ?? ""}`

  const scrollToLocalMessage = useCallback(
    (messageId: string) => {
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
    },
    [messageScrollCommandRef]
  )
  const registerActiveScrollCommand = useCallback(
    (command: MessageScrollCommand | null) => {
      registerScrollCommand(command)
      if (command) {
        ownedCommandRef.current = command
        activeMessageScrollCommand = command
        return
      }
      if (activeMessageScrollCommand === ownedCommandRef.current) {
        activeMessageScrollCommand = null
      }
      ownedCommandRef.current = null
    },
    [registerScrollCommand]
  )

  const handleMessageJump = useCallback(
    (messageId: string) => {
      if (!scrollToLocalMessage(messageId)) onJumpToMessage?.(messageId)
    },
    [onJumpToMessage, scrollToLocalMessage]
  )
  const handleReaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      signalMessageScrollerInteraction(
        event.target,
        messageScrollCommandRef.current
      )
    },
    [messageScrollCommandRef]
  )

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      const el = scrollRef.current
      if (!el) return

      // Determine which date divider has scrolled past the top
      const containerTop = el.getBoundingClientRect().top
      const dividers = el.querySelectorAll("[data-date-divider]")
      let topDate: string | null = null

      for (const divider of dividers) {
        const rect = divider.getBoundingClientRect()
        if (rect.top <= containerTop + 8) {
          topDate = (divider as HTMLElement).dataset.dateDivider ?? null
        } else {
          break
        }
      }

      const stickyDate = stickyDateRef.current
      if (!stickyDate) return
      stickyDate.textContent = topDate ?? ""
      stickyDate.dataset.visible = topDate ? "true" : "false"
    })
  }, [])

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
    },
    []
  )

  // IntersectionObserver for fetching older (top of viewport)
  useEffect(() => {
    const sentinel = olderSentinelRef.current
    const container = scrollRef.current
    if (!sentinel || !container || !hasOlder || !onLoadOlder) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingOlder) {
          onLoadOlder()
        }
      },
      { root: container, rootMargin: "200px" }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasOlder, onLoadOlder, isFetchingOlder])

  // IntersectionObserver for fetching newer (bottom of viewport — only
  // active in anchored mode, where the user is looking at older context)
  useEffect(() => {
    const sentinel = newerSentinelRef.current
    const container = scrollRef.current
    if (!sentinel || !container || !hasNewer || !onLoadNewer) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNewer) {
          onLoadNewer()
        }
      },
      { root: container, rootMargin: "200px" }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNewer, onLoadNewer, isFetchingNewer])

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col justify-end overflow-hidden py-4">
        {MESSAGE_SKELETON_GROUPS.map((group) => (
          <div key={group.key} className="px-4 py-0.5">
            <div className="flex gap-3">
              <Skeleton className="mt-0.5 size-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="flex items-baseline gap-2">
                  <Skeleton
                    className="h-3.5 rounded"
                    style={{ width: group.nameWidth }}
                  />
                  <Skeleton className="h-3 w-10 rounded" />
                </div>
                {group.lines.map((width, i) => (
                  <Skeleton
                    key={`${group.key}-${i}`}
                    className="h-3.5 rounded"
                    style={{ width }}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (messages.length === 0) {
    return <EmptyState context={context} />
  }

  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition={scrollTargetId ? "start" : "end"}
      scrollEdgeThreshold={16}
    >
      <MessageScrollerCommandBridge register={registerActiveScrollCommand} />
      <MessageScrollTarget
        messageId={scrollTargetId}
        contentVersion={contentVersion}
        containerRef={scrollRef}
      />
      <MessageScroller className="min-h-0 flex-1">
        <div
          ref={stickyDateRef}
          data-visible="false"
          className="pointer-events-none absolute top-2 left-1/2 z-30 -translate-x-1/2 rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground opacity-0 shadow-sm transition-[translate,opacity] duration-300 ease-out data-[visible=false]:-translate-y-2 data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100 motion-reduce:transition-none"
        />
        <MessageScrollerViewport
          ref={scrollRef}
          onScroll={handleScroll}
          reconcileFollowOutput={Boolean(pendingMerlinMessage)}
          onPointerDown={handleReaderPointerDown}
          data-message-scroll
          aria-label={`${context.name} messages`}
          className="select-text"
        >
          <MessageScrollerContent
            aria-busy={Boolean(pendingMerlinMessage)}
            className="justify-end py-4"
          >
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

            {orderedMessages.map((msg, i) => {
              const previous = orderedMessages[i - 1]
              const isDateBoundary =
                !previous || !isSameDay(msg.createdAt, previous.createdAt)
              const isWithinGroupWindow =
                !!previous &&
                differenceInMinutes(msg.createdAt, previous.createdAt) <=
                  MESSAGE_GROUP_WINDOW_MINUTES
              const showHeader =
                isDateBoundary ||
                !previous ||
                previous.authorId !== msg.authorId ||
                !isWithinGroupWindow ||
                msg.type === "reply"

              return (
                <MessageScrollerItem key={msg.id} messageId={msg.id}>
                  {isDateBoundary && <DateDivider date={msg.createdAt} />}
                  <MessageItem
                    message={msg}
                    showHeader={showHeader}
                    currentUserId={currentUserId}
                    isBlocked={blockedUserIds?.has(msg.authorId) ?? false}
                    onReact={onReact}
                    onReply={onReply}
                    onReplyInThread={onReplyInThread}
                    onOpenThread={onOpenThread}
                    isReplyTarget={replyingToId === msg.id}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onTogglePin={onTogglePin}
                    canPin={canPin}
                    mentionCandidates={mentionCandidates}
                    onJumpToMessage={handleMessageJump}
                  />
                </MessageScrollerItem>
              )
            })}

            {hasNewer && (
              <MessageScrollerItem>
                <div
                  ref={newerSentinelRef}
                  className="flex justify-center py-3"
                >
                  {isFetchingNewer && (
                    <Spinner className="size-5 text-muted-foreground motion-reduce:animate-none" />
                  )}
                </div>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>

        <MessageScrollerJumpToLatest
          newestMessageId={messages[0]?.id ?? null}
          viewportRef={scrollRef}
          isMerlinResponding={Boolean(pendingMerlinMessage)}
          pendingCount={pendingCount}
          hasUnloadedNewer={Boolean(hasNewer)}
          onJumpToPresent={onJumpToPresent}
        />

        {threadActivities &&
          onOpenThreadActivity &&
          onDismissThreadActivity && (
            <ThreadActivityDock
              activities={threadActivities}
              onOpen={onOpenThreadActivity}
              onDismiss={onDismissThreadActivity}
            />
          )}
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
