import {
  ArrowRight01Icon,
  BrainIcon,
  Pin02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LOR_USER_ID } from "@repo/db/constants"
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
  TooltipCreateHandle,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatTime, timeAgo } from "@repo/utils/date"
import { memo, useCallback, useEffect, useState } from "react"
import { MessageApprovalCard } from "@/components/chat/approval-card"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import { EmbedCard } from "@/components/chat/embed-card"
import { ForwardedMessageCard } from "@/components/chat/forwarded-message-card"
import { LoopCard } from "@/components/chat/loop-card"
import { LorFailureNotice } from "@/components/chat/lor-failure-notice"
import { LorMessageBody } from "@/components/chat/lor-message-body"
import { LorReasoning } from "@/components/chat/lor-reasoning"
import { LorReplyActions } from "@/components/chat/lor-reply-actions"
import {
  isAttioRecording,
  MeetingRecordingCard,
} from "@/components/chat/meeting-recording-card"
import { MessageActionBar } from "@/components/chat/message-action-bar"
import { AttachmentGrid } from "@/components/chat/message-attachment"
import { MessageEditInput } from "@/components/chat/message-edit-input"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { PlanCard } from "@/components/chat/plan-card"
import { ProposalCard } from "@/components/chat/proposal-card"
import { ThinkingIndicator } from "@/components/chat/thinking-indicator"
import { UserProfilePopover } from "@/components/ui/user-profile-card"
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
  // Channel chat: start a Lor session with this message attached.
  onAskLor?: (message: Message) => void
  // Session: forward a message into the channel chat.
  onForward?: (message: Message) => void
  // Session: a new session from one of Lor's finished replies.
  onFork?: (message: Message) => Promise<unknown>
  // Session: the newest Lor reply keeps its action row in view.
  isLatestLorReply?: boolean
  onOpenThread?: (rootMessageId: string) => void
  onDelete?: (messageId: string) => void
  onEdit?: (messageId: string, content: string) => void
  onTogglePin?: (messageId: string, currentlyPinned: boolean) => void
  canPin?: boolean
  mentionCandidates?: MentionCandidate[]
  onJumpToMessage?: (messageId: string) => void
  // Session transcript: reads as a document. Each turn has a small avatar in
  // a narrow gutter and no name row.
  layout?: "chat" | "document"
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
  compact = false,
}: {
  referencedMessage: Message["referencedMessage"]
  mentionCandidates?: MentionCandidate[]
  onJumpToMessage?: (messageId: string) => void
  // Document layout: the curve starts at the 28px gutter avatar's center.
  compact?: boolean
}) {
  const connector = (
    <div
      className={cn(
        "mb-1 h-3 rounded-tl-md border-t-2 border-l-2 border-muted-foreground/40",
        compact ? "ml-3 w-7" : "ml-4 w-8"
      )}
    />
  )
  if (!referencedMessage) {
    return (
      <div
        className={cn(
          "mb-0.5 flex items-center gap-2 text-xs text-muted-foreground italic",
          !compact && "pl-6"
        )}
      >
        {connector}
        <span>Original message was deleted</span>
      </div>
    )
  }

  const author = referencedMessage.author
  const referencedName = referencedMessage.overrideName ?? author.name
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
      {connector}
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

function ReactionPills({
  reactions,
  currentUserId,
  onReact,
}: {
  reactions: Message["reactions"]
  currentUserId: string | undefined
  onReact: (emoji: string) => void
}) {
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((reaction) => {
        const reactors = reaction.reactors ?? []
        const names = reactors.map((r) =>
          r.id === currentUserId ? "You" : r.name
        )
        const tooltipText =
          names.length > 0
            ? `${names.join(", ")} reacted with ${reaction.emoji}`
            : `${reaction.count} reaction${reaction.count !== 1 ? "s" : ""}`

        return (
          <TooltipTrigger
            key={reaction.emoji}
            handle={tooltipHandle}
            payload={tooltipText}
            render={
              <button
                type="button"
                onClick={() => onReact(reaction.emoji)}
                aria-pressed={reaction.reactedByCurrentUser}
                className={cn(
                  "relative inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors pointer-fine:after:absolute pointer-fine:after:left-full pointer-fine:after:h-full pointer-fine:after:w-1",
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
        )
      })}
      <Tooltip handle={tooltipHandle}>
        {({ payload }) => <TooltipContent side="top">{payload}</TooltipContent>}
      </Tooltip>
    </div>
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
  onAskLor,
  onForward,
  onFork,
  isLatestLorReply = false,
  onOpenThread,
  onDelete,
  onEdit,
  onTogglePin,
  canPin = false,
  mentionCandidates,
  onJumpToMessage,
  layout = "chat",
}: MessageItemProps) {
  const author = message.author
  // Webhook/connector messages render an overridden identity and aren't a
  // real user — no profile popover.
  const isApp = !!message.overrideName || !!message.overrideAvatarUrl
  const displayName = message.overrideName ?? author.name
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
  // Match the broadcast tokens recognized by messaging fanout, including app posts.
  const hasBroadcastMention = /(^|\s)@(everyone|channel|here)\b/i.test(
    message.content ?? ""
  )
  const canWrapUnderAvatar =
    wrapContentAroundAvatar && message.authorId === LOR_USER_ID
  const isDocument = layout === "document"
  const isReply = message.type === "reply"
  const hasToolCalls = (message.lorToolCalls?.length ?? 0) > 0
  const hasReasoningSegments = (message.lorReasoningSegments?.length ?? 0) > 0

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

  const handleAskLor = useCallback(() => {
    onAskLor?.(message)
  }, [message, onAskLor])

  const handleForward = useCallback(() => {
    onForward?.(message)
  }, [message, onForward])
  // A finished message with text, Lor's or a person's; never a placeholder,
  // an event line or a card. Mirrors the gateway's loadForwardSnapshot.
  const canForward =
    Boolean(onForward) &&
    (message.type === "default" || message.type === "reply") &&
    message.status === "complete" &&
    !message.streaming &&
    Boolean(message.content?.trim())

  const handleFork = useCallback(
    () => onFork?.(message) ?? Promise.resolve(),
    [message, onFork]
  )
  // The API checks the turn saved; this only hides it where it can't apply.
  const canFork =
    Boolean(onFork) &&
    message.authorId === LOR_USER_ID &&
    (message.type === "default" || message.type === "reply") &&
    message.status === "complete" &&
    !message.streaming
  // Lor's replies in a session get an action row under them instead of the
  // floating bar, once the reply is finished.
  const lorReplyRow = isDocument && message.authorId === LOR_USER_ID
  const replyFinished = !message.streaming && message.status !== "pending"

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

  if (message.type === "agent_session") return null

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

  // Document layout: the first message of each turn wears a small avatar in
  // the gutter (Lor's too) instead of a name row; name and time on hover.
  const documentGutter = (
    <div className="w-7 shrink-0">
      {/* A person's follow-up line shows its time on hover, like channel
          chat; Lor's replies carry theirs in the action row. */}
      {!showHeader && !lorReplyRow && (
        <div className="flex justify-end whitespace-nowrap text-[10px] text-muted-foreground leading-6 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
          {formatTime(message.createdAt)}
        </div>
      )}
      {showHeader && (
        <Avatar
          className="-mt-0.5 size-7"
          title={`${displayName} · ${formatTime(message.createdAt)}`}
        >
          {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
          <AvatarFallback
            avatarColor={author.avatarColor}
            fallbackSeed={displayName}
            className="text-xs font-semibold"
          >
            {getAvatarInitials(displayName)}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  )

  // Plan, loop and proposal cards (and per-fire loop chips) render as their
  // own surface, but inside the normal message row — so they keep Lor's
  // avatar, name and timestamp, and line up with every other message.
  if (
    message.type === "plan_card" ||
    message.type === "loop_card" ||
    message.type === "loop_fire" ||
    message.type === "proposal_card"
  ) {
    // A card in a session (a proposal Lor filed there) follows the
    // document look: gutter avatar, no name row.
    if (isDocument) {
      return (
        <div
          data-message-id={message.id}
          className={cn("group px-4 py-0.5", showHeader && "pt-3")}
        >
          <div className="flex gap-3">
            {documentGutter}
            <div className="min-w-0 flex-1">
              {message.type === "proposal_card" ? (
                <ProposalCard message={message} />
              ) : message.type === "plan_card" ? (
                <PlanCard message={message} />
              ) : (
                <LoopCard message={message} />
              )}
            </div>
          </div>
        </div>
      )
    }
    const planAvatar = (
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
              <div className="mt-0.5 self-start">{planAvatar}</div>
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
                  {planAvatar}
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
            {message.type === "plan_card" ? (
              <PlanCard message={message} />
            ) : message.type === "proposal_card" ? (
              <ProposalCard message={message} />
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
        isDocument && showHeader && "pt-3",
        isReplyTarget
          ? "bg-primary/[0.07] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary"
          : hasBroadcastMention
            ? "bg-gold/10 hover:bg-gold/15 before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-gold"
            : !canWrapUnderAvatar && !isDocument && "hover:bg-muted/30"
      )}
    >
      {!lorReplyRow && (
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
            onAskLor={onAskLor ? handleAskLor : undefined}
            onForward={canForward ? handleForward : undefined}
            onCopyText={handleCopyText}
            onEdit={isOwnMessage && onEdit ? handleEditRequest : undefined}
            onDelete={
              isOwnMessage && onDelete ? handleDeleteRequest : undefined
            }
            onTogglePin={canPin ? handleTogglePin : undefined}
            isPinned={message.pinned}
            canManageMessage={isOwnMessage}
            canPin={canPin}
            onOverlayOpenChange={setIsActionBarPinned}
          />
        </div>
      )}
      {message.pinned && (
        <div
          className={cn(
            "mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground",
            isDocument ? "pl-10" : "pl-[52px]"
          )}
        >
          <HugeiconsIcon icon={Pin02Icon} size={12} />
          <span>Pinned</span>
        </div>
      )}
      {isReply && (
        <ReplyPreview
          referencedMessage={message.referencedMessage}
          mentionCandidates={mentionCandidates}
          onJumpToMessage={onJumpToMessage}
          compact={isDocument}
        />
      )}
      <div className={cn(canWrapUnderAvatar ? "flow-root" : "flex gap-3")}>
        {isDocument ? (
          documentGutter
        ) : showHeader ? (
          isApp ? (
            <div
              className={cn(
                "mt-0.5 self-start",
                canWrapUnderAvatar && "float-left mr-3"
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
                  canWrapUnderAvatar && "float-left mr-3"
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
              canWrapUnderAvatar && "float-left mr-3"
            )}
          >
            <span className="whitespace-nowrap">
              {formatTime(message.createdAt)}
            </span>
          </div>
        )}
        <div
          className={cn(
            "min-w-0",
            !canWrapUnderAvatar && "flex-1",
            // Every turn reads as document prose. The inner `.prose` sets its
            // own size and leading, so pin both.
            isDocument &&
              "[&_.message-markdown]:text-[15px] [&_.message-markdown_.prose]:text-[15px] [&_.message-markdown_.prose]:leading-6",
            // A message for the session's subscribers only (Lor didn't get it) reads
            // as an aside: muted, never labelled.
            isDocument &&
              message.routedToLor === false &&
              "[&_.message-markdown]:text-muted-foreground"
          )}
        >
          {showHeader && !isDocument && (
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
          {message.lorReasoning && !hasReasoningSegments && !hasToolCalls ? (
            <LorReasoning
              text={message.lorReasoning}
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
            !message.lorReasoning &&
            !hasReasoningSegments &&
            !hasToolCalls ? (
            // In-flight Lor reply: `streaming` covers the live client, while
            // `status === "pending"` survives a reload / late thread join. Once
            // reasoning starts, that block takes over the "thinking" affordance.
            <ThinkingIndicator />
          ) : message.status === "failed" &&
            message.authorId === LOR_USER_ID &&
            !hasToolCalls &&
            !hasReasoningSegments ? (
            <LorFailureNotice
              text={message.content || "Lor couldn't respond to that."}
            />
          ) : hasToolCalls || hasReasoningSegments ? (
            <LorMessageBody
              content={message.content}
              toolCalls={message.lorToolCalls ?? []}
              reasoningSegments={message.lorReasoningSegments ?? []}
              streaming={message.streaming || message.status === "pending"}
              failed={message.status === "failed"}
              legacyReasoning={
                !hasReasoningSegments ? message.lorReasoning : null
              }
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
          {message.type === "forward" && message.forwarded && (
            <ForwardedMessageCard forwarded={message.forwarded} />
          )}
          {/* Policy-gated approval parked on this run's reply (LOR-81).
              lorTriggerMessageId marks run replies live and on reload. */}
          {message.lorTriggerMessageId && !isEditing && (
            <MessageApprovalCard
              channelId={message.channelId}
              messageId={message.id}
              threadRootId={isDocument ? message.threadRootId : null}
            />
          )}
          {message.routedOutcome === "steered" && (
            <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-agent/10 px-1.5 py-0.5 text-[11px] text-agent">
              Steering Lor's current answer
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
            <AttachmentGrid
              messageId={message.id}
              attachments={message.attachments}
            />
          )}
          {message.embeds.length > 0 && (
            <div className="flex flex-col gap-1">
              {message.embeds.map((embed, index) =>
                isAttioRecording(embed) ? (
                  <MeetingRecordingCard
                    // recordingId keeps card state (transcript expand) pinned
                    // to the recording if embeds reorder; eventLabel-matched
                    // embeds lack it.
                    key={embed.meeting?.recordingId ?? `${embed.url}-${index}`}
                    embed={embed}
                    message={message}
                  />
                ) : (
                  <EmbedCard key={`${embed.url}-${index}`} embed={embed} />
                )
              )}
            </div>
          )}
          {message.reactions.length > 0 && (
            <ReactionPills
              reactions={message.reactions}
              currentUserId={currentUserId}
              onReact={handleReact}
            />
          )}
          {lorReplyRow && replyFinished && !isEditing && (
            <LorReplyActions
              alwaysVisible={isLatestLorReply}
              time={formatTime(message.createdAt)}
              onCopyText={message.content ? handleCopyText : undefined}
              onReact={handleReact}
              onReply={handleReply}
              onForward={canForward ? handleForward : undefined}
              onFork={canFork ? handleFork : undefined}
              onTogglePin={canPin ? handleTogglePin : undefined}
              isPinned={message.pinned}
            />
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
