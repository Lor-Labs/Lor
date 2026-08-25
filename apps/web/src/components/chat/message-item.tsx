import {
  ArrowRight01Icon,
  BrainIcon,
  Pin02Icon,
  SquareIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatTime, timeAgo } from "@repo/utils/date"
import { memo, useCallback, useEffect, useState } from "react"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import { EmbedCard } from "@/components/chat/embed-card"
import { LoopCard } from "@/components/chat/loop-card"
import { MerlinMessageBody } from "@/components/chat/merlin-message-body"
import { MerlinReasoning } from "@/components/chat/merlin-reasoning"
import { MessageActionBar } from "@/components/chat/message-action-bar"
import { AttachmentGrid } from "@/components/chat/message-attachment"
import { MessageEditInput } from "@/components/chat/message-edit-input"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { TaskCard } from "@/components/chat/task-card"
import { ThinkingIndicator } from "@/components/chat/thinking-indicator"
import { UserProfilePopover } from "@/components/ui/user-profile-card"
import { useStopMerlinRun } from "@/hooks/use-stop-merlin-run"
import type { Message } from "@/lib/api-types"
import { connectorMessageEmbed } from "@/lib/connector-message-embed"
import {
  connectorAvatarClassName,
  connectorForName,
  connectorLogo,
} from "@/lib/connector-ui"
import { toSearchPreviewText } from "@/lib/search-preview"

interface MessageItemProps {
  message: Message
  showHeader: boolean
  /** Let thread message bodies reclaim the avatar gutter once they clear it. */
  wrapContentAroundAvatar?: boolean
  currentUserId?: string
  isBlocked?: boolean
  isReplyTarget?: boolean
  onReact?: (messageId: string, emoji: string) => void
  onReply?: (message: Message) => void
  onReplyInThread?: (message: Message) => void
  onOpenThread?: (rootMessageId: string) => void
  onDelete?: (messageId: string) => void
  onEdit?: (messageId: string, content: string) => void
  onTogglePin?: (messageId: string, currentlyPinned: boolean) => void
  canPin?: boolean
  mentionCandidates?: MentionCandidate[]
  onJumpToMessage?: (messageId: string) => void
  showMerlinRunControls?: boolean
}

const PREVIEW_MAX_CHARS = 100

// Prefer the mentions the API now attaches to the quoted message; fall back to
// the channel's mentionable users for optimistic sends and older payloads that
// predate that field. Converting before truncating also stops a token being
// sliced in half mid-uuid.
function replyPreviewText(
  referencedMessage: NonNullable<Message["referencedMessage"]>,
  mentionCandidates?: MentionCandidate[]
) {
  const mentions = referencedMessage.mentions?.length
    ? referencedMessage.mentions
    : (mentionCandidates ?? []).map((candidate) => ({
        id: candidate.id,
        name: candidate.name ?? candidate.label,
        username: candidate.username ?? null,
        displayUsername: candidate.displayUsername ?? null,
      }))
  const text = toSearchPreviewText(referencedMessage.content, mentions)
  return text.length > PREVIEW_MAX_CHARS
    ? `${text.slice(0, PREVIEW_MAX_CHARS)}...`
    : text
}

function ReplyPreview({
  referencedMessage,
  mentionCandidates,
  onJumpToMessage,
}: {
  referencedMessage: Message["referencedMessage"]
  mentionCandidates?: MentionCandidate[]
  onJumpToMessage?: (messageId: string) => void
}) {
  if (!referencedMessage) {
    return (
      <div className="mb-0.5 flex items-center gap-2 pl-6 text-xs text-muted-foreground italic">
        <div className="mb-1 ml-4 h-3 w-8 rounded-tl-md border-t-2 border-l-2 border-muted-foreground/40" />
        <span>Original message was deleted</span>
      </div>
    )
  }

  const author = referencedMessage.author
  const referencedName =
    referencedMessage.overrideName ?? author.displayUsername ?? author.name
  const referencedAvatar = referencedMessage.overrideAvatarUrl ?? author.image
  const referencedConnector = referencedMessage.overrideAvatarUrl
    ? null
    : connectorForName(referencedMessage.overrideName)
  const ReferencedConnectorMark = referencedConnector
    ? connectorLogo(referencedConnector)
    : null
  const truncatedContent = replyPreviewText(
    referencedMessage,
    mentionCandidates
  )

  return (
    <button
      type="button"
      onClick={() => onJumpToMessage?.(referencedMessage.id)}
      className="mb-0.5 flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-xs hover:opacity-80"
    >
      <div className="mb-1 ml-4 h-3 w-8 rounded-tl-md border-t-2 border-l-2 border-muted-foreground/40" />
      <Avatar size="sm" className="size-4">
        {referencedAvatar && (
          <AvatarImage src={referencedAvatar} alt={referencedName} />
        )}
        <AvatarFallback
          avatarColor={author.avatarColor}
          className={cn(
            "text-[8px] font-semibold",
            referencedConnector && connectorAvatarClassName(referencedConnector)
          )}
          fallbackSeed={referencedName}
        >
          {ReferencedConnectorMark ? (
            <ReferencedConnectorMark className="size-2.5" />
          ) : (
            getAvatarInitials(referencedName)
          )}
        </AvatarFallback>
      </Avatar>
      <span className="shrink-0 font-semibold text-foreground/80">
        {referencedName}
      </span>
      {truncatedContent && (
        <span className="truncate text-muted-foreground">
          {truncatedContent}
        </span>
      )}
    </button>
  )
}

// Steer status + explicit Stop for an in-flight Merlin reply. Stop is honored
// by the run at its next safe step boundary; whatever streamed is kept.
function MerlinRunControls({ message }: { message: Message }) {
  const stop = useStopMerlinRun()

  return (
    <div className="mt-1.5 flex items-center gap-3">
      {message.steeringBy && (
        <span className="text-xs italic text-merlin">
          Applying {message.steeringBy}'s new direction…
        </span>
      )}
      {message.stopRequested ? (
        <span className="text-xs text-muted-foreground italic">Stopping…</span>
      ) : (
        <button
          type="button"
          onClick={() => stop.mutate(message)}
          disabled={stop.isPending}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon
            icon={SquareIcon}
            className="size-2.5 fill-current"
            strokeWidth={2}
          />
          Stop
        </button>
      )}
    </div>
  )
}

function ThreadFooter({
  summary,
  onClick,
}: {
  summary: NonNullable<Message["threadSummary"]>
  onClick: () => void
}) {
  const replyLabel =
    summary.replyCount === 1 ? "1 reply" : `${summary.replyCount} replies`
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/thread mt-1.5 flex w-full max-w-[480px] items-center gap-2 rounded-lg border border-transparent py-1 pr-2 pl-1 text-[12.5px]",
        // `bg-sidebar` is the one token below `--background` in the surface
        // hierarchy — gives a "deeper / pressed-in" hover in both themes.
        "transition-colors hover:border-border/70 hover:bg-sidebar/50 cursor-pointer"
      )}
    >
      <div className="flex shrink-0 -space-x-1.5">
        {summary.participants.slice(0, 3).map((p) => (
          <span
            key={p.id}
            className="rounded-full ring-2 ring-background transition-[box-shadow] group-hover/thread:ring-card"
          >
            <Avatar size="sm" className="size-[22px]">
              {p.image && <AvatarImage src={p.image} alt={p.name} />}
              <AvatarFallback
                avatarColor={p.avatarColor}
                className="text-[10px] font-semibold"
                fallbackSeed={p.name}
              >
                {getAvatarInitials(p.name)}
              </AvatarFallback>
            </Avatar>
          </span>
        ))}
      </div>
      <span className="shrink-0 font-semibold text-primary group-hover/thread:underline">
        {replyLabel}
      </span>
      <span className="truncate text-muted-foreground">
        Last reply {timeAgo(summary.lastReplyAt)}
      </span>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        className="-mr-0.5 ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thread:opacity-100"
        strokeWidth={2.25}
      />
    </button>
  )
}

export const MessageItem = memo(function MessageItem({
  message,
  showHeader,
  wrapContentAroundAvatar = false,
  currentUserId,
  isBlocked = false,
  isReplyTarget = false,
  onReact,
  onReply,
  onReplyInThread,
  onOpenThread,
  onDelete,
  onEdit,
  onTogglePin,
  canPin = false,
  mentionCandidates,
  onJumpToMessage,
  showMerlinRunControls = true,
}: MessageItemProps) {
  const author = message.author
  // Webhook/connector messages render an overridden identity and aren't a
  // real user — no profile popover.
  const isApp = !!message.overrideName || !!message.overrideAvatarUrl
  const displayName =
    message.overrideName ?? author.displayUsername ?? author.name
  const avatarUrl = message.overrideAvatarUrl ?? author.image
  // Connector-named bot posts ("GitHub", "Linear") wear the provider mark
  // when no uploaded avatar is set.
  const connectorKey = message.overrideAvatarUrl
    ? null
    : connectorForName(message.overrideName)
  const ConnectorMark = connectorKey ? connectorLogo(connectorKey) : null
  const [isActionBarPinned, setIsActionBarPinned] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [showBlockedContent, setShowBlockedContent] = useState(false)

  useEffect(() => {
    setShowBlockedContent(false)
  }, [message.id])

  const isOwnMessage = !!currentUserId && currentUserId === message.authorId
  const isReply = message.type === "reply"
  const hasToolCalls = (message.merlinToolCalls?.length ?? 0) > 0
  const hasReasoningSegments =
    (message.merlinReasoningSegments?.length ?? 0) > 0

  const handleCopyText = useCallback(() => {
    if (!message.content) return

    void navigator.clipboard.writeText(message.content).catch(() => {})
  }, [message.content])

  const handleReact = useCallback(
    (emoji: string) => {
      if (!currentUserId) return
      if (!onReact) return

      onReact(message.id, emoji)
    },
    [currentUserId, message.id, onReact]
  )

  const handleReply = useCallback(() => {
    onReply?.(message)
  }, [message, onReply])

  const handleReplyInThread = useCallback(() => {
    onReplyInThread?.(message)
  }, [message, onReplyInThread])

  const handleOpenThread = useCallback(() => {
    onOpenThread?.(message.id)
  }, [message.id, onOpenThread])

  // Channel-level messages (not thread replies) can host a thread.
  const canStartThread = !message.threadRootId && !!onReplyInThread

  const handleDeleteRequest = useCallback(() => {
    setIsDeleteDialogOpen(true)
  }, [])

  const handleDeleteConfirm = useCallback(() => {
    onDelete?.(message.id)
    setIsDeleteDialogOpen(false)
  }, [message.id, onDelete])

  const handleTogglePin = useCallback(() => {
    onTogglePin?.(message.id, message.pinned)
  }, [message.id, message.pinned, onTogglePin])

  const handleEditRequest = useCallback(() => {
    setIsEditing(true)
  }, [])

  const handleEditSave = useCallback(
    (content: string) => {
      onEdit?.(message.id, content)
      setIsEditing(false)
    },
    [message.id, onEdit]
  )

  const handleEditCancel = useCallback(() => {
    setIsEditing(false)
  }, [])

  if (isBlocked && !showBlockedContent) {
    return (
      <div data-message-id={message.id} className="px-4 py-1">
        <button
          type="button"
          className="text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          onClick={() => setShowBlockedContent(true)}
        >
          Blocked message — click to reveal
        </button>
      </div>
    )
  }

  // Task and loop cards (and per-fire loop chips) render as their own
  // surface, but inside the normal message row — so they keep Merlin's
  // avatar, name and timestamp, and line up with every other message.
  if (
    message.type === "task_card" ||
    message.type === "loop_card" ||
    message.type === "loop_fire"
  ) {
    const taskAvatar = (
      <Avatar size="lg">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
        <AvatarFallback
          avatarColor={author.avatarColor}
          className="text-base font-semibold"
          fallbackSeed={author.name}
        >
          {getAvatarInitials(author.name)}
        </AvatarFallback>
      </Avatar>
    )
    return (
      <div data-message-id={message.id} className="group px-4 py-0.5">
        <div className="flex gap-3">
          {showHeader ? (
            isApp ? (
              <div className="mt-0.5 self-start">{taskAvatar}</div>
            ) : (
              <UserProfilePopover
                align="start"
                avatarColor={author.avatarColor}
                side="right"
                userId={author.id}
              >
                <button
                  type="button"
                  className="mt-0.5 cursor-pointer self-start"
                >
                  {taskAvatar}
                </button>
              </UserProfilePopover>
            )
          ) : (
            <div className="w-10 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            {showHeader && (
              <div className="flex items-baseline gap-2">
                {isApp ? (
                  <span className="text-sm font-semibold leading-snug">
                    {displayName}
                  </span>
                ) : (
                  <UserProfilePopover
                    avatarColor={author.avatarColor}
                    userId={author.id}
                    side="right"
                    align="start"
                  >
                    <button
                      type="button"
                      className="cursor-pointer text-sm font-semibold leading-snug hover:underline"
                    >
                      {displayName}
                    </button>
                  </UserProfilePopover>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatTime(message.createdAt)}
                </span>
              </div>
            )}
            {message.type === "task_card" ? (
              <TaskCard message={message} onOpenThread={onOpenThread} />
            ) : (
              <LoopCard message={message} />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      data-message-id={message.id}
      className={cn(
        "group relative px-4 py-0.5 transition-colors",
        isReplyTarget
          ? "bg-primary/[0.07] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary"
          : "hover:bg-muted/40"
      )}
    >
      <div
        className={cn(
          "absolute top-0 right-4 z-20 -translate-y-1/2 opacity-0 transition-opacity duration-100",
          "pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100",
          isActionBarPinned && "pointer-events-auto opacity-100"
        )}
      >
        <MessageActionBar
          onReact={handleReact}
          onReply={handleReply}
          onReplyInThread={canStartThread ? handleReplyInThread : undefined}
          onCopyText={handleCopyText}
          onEdit={isOwnMessage && onEdit ? handleEditRequest : undefined}
          onDelete={isOwnMessage && onDelete ? handleDeleteRequest : undefined}
          onTogglePin={canPin ? handleTogglePin : undefined}
          isPinned={message.pinned}
          canManageMessage={isOwnMessage}
          canPin={canPin}
          onOverlayOpenChange={setIsActionBarPinned}
        />
      </div>
      {message.pinned && (
        <div className="mb-0.5 flex items-center gap-1.5 pl-[52px] text-xs text-muted-foreground">
          <HugeiconsIcon icon={Pin02Icon} size={12} />
          <span>Pinned</span>
        </div>
      )}
      {isReply && (
        <ReplyPreview
          referencedMessage={message.referencedMessage}
          mentionCandidates={mentionCandidates}
          onJumpToMessage={onJumpToMessage}
        />
      )}
      <div className={cn(wrapContentAroundAvatar ? "flow-root" : "flex gap-3")}>
        {showHeader ? (
          isApp ? (
            <div
              className={cn(
                "mt-0.5 self-start",
                wrapContentAroundAvatar && "float-left mr-3"
              )}
            >
              <Avatar size="lg">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
                <AvatarFallback
                  avatarColor={author.avatarColor}
                  className={cn(
                    "text-base font-semibold",
                    connectorKey && connectorAvatarClassName(connectorKey)
                  )}
                  fallbackSeed={displayName}
                >
                  {ConnectorMark ? (
                    <ConnectorMark className="size-6" />
                  ) : (
                    getAvatarInitials(displayName)
                  )}
                </AvatarFallback>
              </Avatar>
            </div>
          ) : (
            <UserProfilePopover
              align="start"
              avatarColor={author.avatarColor}
              side="right"
              userId={author.id}
            >
              <button
                type="button"
                className={cn(
                  "mt-0.5 cursor-pointer self-start",
                  wrapContentAroundAvatar && "float-left mr-3"
                )}
              >
                <Avatar size="lg">
                  {avatarUrl && (
                    <AvatarImage src={avatarUrl} alt={displayName} />
                  )}
                  <AvatarFallback
                    avatarColor={author.avatarColor}
                    className="text-base font-semibold"
                    fallbackSeed={author.name}
                  >
                    {getAvatarInitials(author.name)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </UserProfilePopover>
          )
        ) : (
          <div
            className={cn(
              "w-10 shrink-0 text-right text-[10px] leading-6 text-muted-foreground opacity-0 transition-opacity duration-100 group-hover:opacity-100",
              wrapContentAroundAvatar && "float-left mr-3"
            )}
          >
            <span className="whitespace-nowrap">
              {formatTime(message.createdAt)}
            </span>
          </div>
        )}
        <div className={cn("min-w-0", !wrapContentAroundAvatar && "flex-1")}>
          {showHeader && (
            <div className="flex items-baseline gap-2">
              {isApp ? (
                <span className="text-sm font-semibold leading-snug">
                  {displayName}
                </span>
              ) : (
                <UserProfilePopover
                  avatarColor={author.avatarColor}
                  userId={author.id}
                  side="right"
                  align="start"
                >
                  <button
                    type="button"
                    className="cursor-pointer text-sm font-semibold leading-snug hover:underline"
                  >
                    {displayName}
                  </button>
                </UserProfilePopover>
              )}
              {isApp && (
                <span className="self-center rounded-sm bg-primary/15 px-1 py-px text-[10px] font-semibold text-primary">
                  APP
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {formatTime(message.createdAt)}
              </span>
            </div>
          )}
          {message.merlinReasoning && !hasReasoningSegments ? (
            <MerlinReasoning
              text={message.merlinReasoning}
              active={!!message.streaming && !message.content}
            />
          ) : null}
          {isEditing ? (
            <MessageEditInput
              initialContent={message.content ?? ""}
              onSave={handleEditSave}
              onCancel={handleEditCancel}
              mentionCandidates={mentionCandidates}
            />
          ) : (message.streaming || message.status === "pending") &&
            !message.content &&
            !message.merlinReasoning &&
            !hasReasoningSegments &&
            !hasToolCalls ? (
            // In-flight Merlin reply: `streaming` covers the live client, while
            // `status === "pending"` survives a reload / late thread join. Once
            // reasoning starts, that block takes over the "thinking" affordance.
            <ThinkingIndicator />
          ) : message.status === "failed" && !message.content ? (
            <span className="text-sm text-muted-foreground italic">
              Merlin couldn't respond to that.
            </span>
          ) : hasToolCalls || hasReasoningSegments ? (
            <MerlinMessageBody
              content={message.content}
              toolCalls={message.merlinToolCalls ?? []}
              reasoningSegments={message.merlinReasoningSegments ?? []}
              streaming={message.streaming}
              mentions={message.mentions}
              onCitationJump={onJumpToMessage}
            />
          ) : connectorKey && message.embeds.length > 0 ? null : connectorKey &&
            message.content ? (
            <EmbedCard
              embed={connectorMessageEmbed(
                connectorKey,
                message.content,
                displayName
              )}
            />
          ) : (
            <MessageMarkdown
              content={message.content}
              mentions={message.mentions}
              editedAt={message.editedAt}
              onCitationJump={onJumpToMessage}
            />
          )}
          {showMerlinRunControls &&
            !isEditing &&
            (message.streaming || message.status === "pending") && (
              <MerlinRunControls message={message} />
            )}
          {message.routedOutcome === "steered" && (
            <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-merlin/10 px-1.5 py-0.5 text-[11px] text-merlin">
              Steering Merlin's current answer
            </span>
          )}
          {message.remembered && message.remembered.length > 0 && (
            <div className="mt-3.5 flex flex-wrap gap-1.5">
              {message.remembered.map((r) => (
                <span
                  key={r.path}
                  className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 py-1 pr-2.5 pl-2 text-xs text-muted-foreground"
                >
                  <HugeiconsIcon
                    icon={BrainIcon}
                    className="size-3.5 shrink-0 text-primary"
                    strokeWidth={2}
                  />
                  <span>
                    {r.action === "created"
                      ? "Saved to memory"
                      : "Updated memory"}
                    <span className="ml-1.5 font-mono text-[11px] text-foreground/85">
                      {r.path}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          )}
          {message.attachments && message.attachments.length > 0 && (
            <AttachmentGrid attachments={message.attachments} />
          )}
          {message.embeds.length > 0 && (
            <div className="flex flex-col gap-1">
              {message.embeds.map((embed, index) => (
                <EmbedCard key={`${embed.url}-${index}`} embed={embed} />
              ))}
            </div>
          )}
          {message.reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {message.reactions.map((reaction) => {
                const reactors = reaction.reactors ?? []
                const names = reactors.map((r) =>
                  r.id === currentUserId ? "You" : r.name
                )
                const tooltipText =
                  names.length > 0
                    ? `${names.join(", ")} reacted with ${reaction.emoji}`
                    : `${reaction.count} reaction${reaction.count !== 1 ? "s" : ""}`

                return (
                  <Tooltip key={reaction.emoji}>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={() => handleReact(reaction.emoji)}
                          aria-pressed={reaction.reactedByCurrentUser}
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                            reaction.reactedByCurrentUser
                              ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/20"
                              : "border-border/70 bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                          )}
                        />
                      }
                    >
                      <span>{reaction.emoji}</span>
                      <span>{reaction.count}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs">{tooltipText}</p>
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          )}
          {message.threadSummary && message.threadSummary.replyCount > 0 && (
            <ThreadFooter
              summary={message.threadSummary}
              onClick={handleOpenThread}
            />
          )}
        </div>
      </div>
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this message? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button variant="destructive" onClick={handleDeleteConfirm} />
              }
            >
              Delete
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
})
