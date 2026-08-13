import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import Brain01Icon from "@hugeicons/core-free-icons/Brain01Icon"
import Pin02Icon from "@hugeicons/core-free-icons/Pin02Icon"
import StopIcon from "@hugeicons/core-free-icons/StopIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { MERLIN_USER_ID } from "@repo/db/constants"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatDateDivider, formatDateTime, timeAgo } from "@repo/utils/date"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"
import { ConnectorIcon, connectorForName } from "@/components/connector-icon"
import { MerlinMessageBody } from "@/components/merlin-message-body"
import { MerlinReasoning } from "@/components/merlin-reasoning"
import { MessageAttachments } from "@/components/message-attachments"
import { MessageContent } from "@/components/message-content"
import { MessageEmbed } from "@/components/message-embed"
import { TaskCard } from "@/components/task-card"
import { ThinkingIndicator } from "@/components/thinking-indicator"
import { Avatar } from "@/components/ui/avatar"
import { useStopMerlinRun } from "@/hooks/use-stop-merlin-run"
import type { Message } from "@/lib/api-types"
import { toSearchPreviewText } from "@/lib/message-markdown"
import { isOptimisticMessage } from "@/lib/messages"

export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000

export function messageDisplayName(message: Message) {
  return (
    message.overrideName ??
    message.author.displayUsername ??
    message.author.name
  )
}

function avatarInitial(message: Message) {
  return getAvatarInitials(messageDisplayName(message))
}

// Webhook/app posts author as the shared app user — no profile to show.
function authorPressHandler(
  message: Message,
  onPressAuthor?: (message: Message) => void
) {
  if (!onPressAuthor) return undefined
  if (message.overrideName || message.overrideAvatarUrl) return undefined
  return () => onPressAuthor(message)
}

export function areMessagesOnSameDay(left: string, right: string) {
  const leftDate = new Date(left)
  const rightDate = new Date(right)
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  )
}

function MessageAvatar({
  avatarColor,
  message,
  size = "sm",
}: {
  avatarColor?: string | null
  message: Message
  size?: "sm" | "md"
}) {
  const foreground = useThemeColor("foreground")
  const isMerlin = message.authorId === MERLIN_USER_ID
  const connector = message.overrideAvatarUrl
    ? null
    : connectorForName(message.overrideName)

  return (
    <Avatar
      avatarColor={avatarColor}
      color={isMerlin ? "accent" : "default"}
      fallback={
        connector ? (
          <ConnectorIcon color={foreground} connector={connector} size={18} />
        ) : isMerlin ? (
          "M"
        ) : (
          avatarInitial(message)
        )
      }
      image={message.overrideAvatarUrl ?? message.author.image}
      name={messageDisplayName(message)}
      size={size}
    />
  )
}

function PinnedBadge() {
  const accent = useThemeColor("accent")
  return (
    <View className="mb-one flex-row items-center gap-one">
      <HugeiconsIcon color={accent} icon={Pin02Icon} size={12} />
      <Text className="text-xs text-muted">Pinned</Text>
    </View>
  )
}

function AppBadge() {
  return (
    <Text className="rounded-sm bg-accent-soft px-one py-px text-[9px] font-bold text-accent">
      APP
    </Text>
  )
}

// Steer status + explicit Stop for an in-flight Merlin reply. Stop is honored
// by the run at its next safe step boundary; whatever streamed is kept.
function MerlinRunControls({ message }: { message: Message }) {
  const muted = useThemeColor("muted")
  const { requestStop, stoppingMessageId } = useStopMerlinRun()
  const isStopping = stoppingMessageId === message.id

  return (
    <View className="mt-one flex-row items-center gap-three">
      {message.steeringBy ? (
        <Text className="text-xs italic text-accent">
          Applying {message.steeringBy}&apos;s new direction…
        </Text>
      ) : null}
      {isStopping ? (
        <Text className="text-xs italic text-muted">Stopping…</Text>
      ) : (
        <Pressable
          accessibilityLabel="Stop Merlin's reply"
          accessibilityRole="button"
          className="min-h-7 flex-row items-center gap-one self-start rounded-lor-sm border border-border px-two py-one"
          onPress={() => void requestStop(message.id)}
        >
          <HugeiconsIcon color={muted} icon={StopIcon} size={12} />
          <Text className="text-xs font-semibold text-muted">Stop</Text>
        </Pressable>
      )}
    </View>
  )
}

// A mid-run send was absorbed into the active run's next step boundary.
// (Queued sends surface in the composer's run-queue pill instead.)
function RoutedChip() {
  return (
    <View className="mt-one self-start rounded-lor-sm bg-accent-soft px-two py-one">
      <Text className="text-[11px] text-accent">
        Steering Merlin&apos;s current answer
      </Text>
    </View>
  )
}

function MessageRowBody({
  message,
  onOpenThread,
  onJumpToMessage,
  onToggleReaction,
  showMerlinRunControls = true,
}: {
  message: Message
  onOpenThread?: (message: Message) => void
  onJumpToMessage?: (messageId: string) => void
  onToggleReaction?: (message: Message, emoji: string) => void
  showMerlinRunControls?: boolean
}) {
  const accent = useThemeColor("accent")
  const isMerlin = message.authorId === MERLIN_USER_ID
  const isPending = isOptimisticMessage(message)
  const isStreaming = isMerlin && message.status === "pending"
  const hasTimeline =
    (message.merlinToolCalls?.length ?? 0) > 0 ||
    (message.merlinReasoningSegments?.length ?? 0) > 0

  return (
    <>
      {isPending ? (
        <Text className="self-end text-[11px] font-semibold text-muted">
          Sending
        </Text>
      ) : null}
      {message.type === "task_card" ? (
        <TaskCard message={message} onOpenThread={onOpenThread} />
      ) : (
        <>
          {message.type === "reply" ? (
            <ReplyPreview message={message} onJumpToMessage={onJumpToMessage} />
          ) : null}
          {isMerlin &&
          message.merlinReasoning &&
          (message.merlinReasoningSegments?.length ?? 0) === 0 ? (
            <MerlinReasoning
              active={isStreaming && !message.content}
              text={message.merlinReasoning}
            />
          ) : null}
          {isMerlin && hasTimeline ? (
            <MerlinMessageBody
              message={message}
              onCitationJump={onJumpToMessage}
              streaming={isStreaming}
            />
          ) : message.content ? (
            <MessageContent
              content={message.content}
              mentions={message.mentions}
              onCitationJump={onJumpToMessage}
              streaming={isStreaming}
            />
          ) : null}
          {isStreaming && !message.content && !hasTimeline ? (
            <ThinkingIndicator />
          ) : null}
          {isMerlin && message.status === "failed" && !message.content ? (
            <Text className="text-sm italic text-muted">
              Merlin couldn&apos;t respond to that.
            </Text>
          ) : null}
          {showMerlinRunControls && isStreaming ? (
            <MerlinRunControls message={message} />
          ) : null}
          {message.routedOutcome === "steered" ? <RoutedChip /> : null}
          {message.editedAt ? (
            <Text className="text-[11px] text-muted">(edited)</Text>
          ) : null}
        </>
      )}
      {message.remembered?.length ? (
        <View className="mt-two flex-row flex-wrap gap-one">
          {message.remembered.map((memory) => (
            <View
              className="flex-row items-center gap-two rounded-lor-sm border border-accent-soft bg-accent-soft px-two py-one"
              key={memory.path}
            >
              <HugeiconsIcon color={accent} icon={Brain01Icon} size={14} />
              <Text className="text-xs text-muted">
                {memory.action === "created"
                  ? "Saved to memory"
                  : "Updated memory"}{" "}
                <Text className="font-mono text-xs text-foreground">
                  {memory.path}
                </Text>
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {message.attachments?.length ? (
        <MessageAttachments attachments={message.attachments} />
      ) : null}
      {message.embeds.map((embed, index) => (
        <MessageEmbed embed={embed} key={`${embed.url}-${index}`} />
      ))}
      {message.reactions.length > 0 ? (
        <View className="mt-one flex-row flex-wrap gap-one">
          {message.reactions.map((reaction) => (
            <Pressable
              accessibilityLabel={`${reaction.emoji}, ${reaction.count} ${reaction.count === 1 ? "reaction" : "reactions"}`}
              accessibilityRole="button"
              accessibilityState={{
                selected: reaction.reactedByCurrentUser,
              }}
              className={`min-h-7 flex-row items-center gap-one rounded-full border px-two py-one ${
                reaction.reactedByCurrentUser
                  ? "border-accent bg-accent-soft"
                  : "border-border bg-background"
              }`}
              disabled={!onToggleReaction}
              key={reaction.emoji}
              onPress={() => onToggleReaction?.(message, reaction.emoji)}
            >
              <Text className="text-xs">{reaction.emoji}</Text>
              <Text
                className={`text-xs font-semibold ${
                  reaction.reactedByCurrentUser ? "text-accent" : "text-muted"
                }`}
              >
                {reaction.count}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {onOpenThread && message.threadSummary ? (
        <ThreadFooter message={message} onOpenThread={onOpenThread} />
      ) : null}
    </>
  )
}

export function MessageRow({
  avatarColorByUserId,
  message,
  showHeader,
  onOpenThread,
  onJumpToMessage,
  onPressAuthor,
  isHighlighted = false,
  isActionHighlighted = false,
  onToggleReaction,
  showMerlinRunControls = true,
}: {
  avatarColorByUserId?: ReadonlyMap<string, string>
  message: Message
  showHeader: boolean
  onOpenThread?: (message: Message) => void
  onJumpToMessage?: (messageId: string) => void
  onPressAuthor?: (message: Message) => void
  isHighlighted?: boolean
  isActionHighlighted?: boolean
  onToggleReaction?: (message: Message, emoji: string) => void
  showMerlinRunControls?: boolean
}) {
  const isMerlin = message.authorId === MERLIN_USER_ID
  const isApp = Boolean(message.overrideName || message.overrideAvatarUrl)
  const authorPress = authorPressHandler(message, onPressAuthor)
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })

  return (
    <View
      className={`${showHeader ? "py-three" : "py-[3px]"} ${
        isHighlighted ? "bg-accent-soft" : ""
      } relative flex-row gap-three px-four`}
    >
      {isActionHighlighted ? (
        <Animated.View
          className="absolute inset-0 bg-surface-secondary"
          entering={FadeIn.duration(70)}
          exiting={FadeOut.duration(180)}
          pointerEvents="none"
        />
      ) : null}
      {isHighlighted ? (
        <View className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
      ) : null}
      <View className="min-w-10 pt-px">
        {showHeader ? (
          <Pressable
            accessibilityElementsHidden
            accessible={false}
            disabled={!authorPress}
            importantForAccessibility="no-hide-descendants"
            onPress={authorPress}
          >
            <MessageAvatar
              avatarColor={
                message.author.avatarColor ??
                avatarColorByUserId?.get(message.author.id)
              }
              message={message}
            />
          </Pressable>
        ) : null}
      </View>
      <View className="min-w-0 flex-1 gap-[2px]">
        {message.pinned ? <PinnedBadge /> : null}
        {showHeader ? (
          <View className="flex-row items-baseline gap-two">
            <Text
              accessibilityLabel={
                authorPress
                  ? `View ${messageDisplayName(message)}'s profile`
                  : undefined
              }
              accessibilityRole={authorPress ? "button" : undefined}
              className={
                isMerlin
                  ? "text-[15px] font-bold tracking-[-0.1px] text-accent"
                  : "text-[15px] font-bold tracking-[-0.1px] text-foreground"
              }
              onPress={authorPress}
              suppressHighlighting
            >
              {messageDisplayName(message)}
            </Text>
            {isApp ? <AppBadge /> : null}
            <Text className="text-xs font-medium text-muted">{time}</Text>
          </View>
        ) : null}
        <MessageRowBody
          message={message}
          onJumpToMessage={onJumpToMessage}
          onOpenThread={onOpenThread}
          onToggleReaction={onToggleReaction}
          showMerlinRunControls={showMerlinRunControls}
        />
      </View>
    </View>
  )
}

export function ThreadRootMessage({
  avatarColorByUserId,
  message,
  isHighlighted = false,
  isActionHighlighted = false,
  onJumpToMessage,
  onPressAuthor,
  onToggleReaction,
  showMerlinRunControls = true,
}: {
  avatarColorByUserId?: ReadonlyMap<string, string>
  message: Message
  isHighlighted?: boolean
  isActionHighlighted?: boolean
  onJumpToMessage?: (messageId: string) => void
  onPressAuthor?: (message: Message) => void
  onToggleReaction?: (message: Message, emoji: string) => void
  showMerlinRunControls?: boolean
}) {
  const isMerlin = message.authorId === MERLIN_USER_ID
  const isApp = Boolean(message.overrideName || message.overrideAvatarUrl)
  const authorPress = authorPressHandler(message, onPressAuthor)

  return (
    <View
      className={`${
        isHighlighted ? "bg-accent-soft" : ""
      } relative gap-two px-four pb-one pt-three`}
    >
      {isActionHighlighted ? (
        <Animated.View
          className="absolute inset-0 bg-surface-secondary"
          entering={FadeIn.duration(70)}
          exiting={FadeOut.duration(180)}
          pointerEvents="none"
        />
      ) : null}
      {isHighlighted ? (
        <View className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
      ) : null}
      <View className="flex-row items-center gap-three">
        <Pressable
          accessibilityElementsHidden
          accessible={false}
          disabled={!authorPress}
          importantForAccessibility="no-hide-descendants"
          onPress={authorPress}
        >
          <MessageAvatar
            avatarColor={
              message.author.avatarColor ??
              avatarColorByUserId?.get(message.author.id)
            }
            message={message}
            size="md"
          />
        </Pressable>
        <View className="min-w-0 flex-1 gap-px">
          <View className="flex-row items-center gap-two">
            <Text
              accessibilityLabel={
                authorPress
                  ? `View ${messageDisplayName(message)}'s profile`
                  : undefined
              }
              accessibilityRole={authorPress ? "button" : undefined}
              className={
                isMerlin
                  ? "text-base font-bold tracking-[-0.2px] text-accent"
                  : "text-base font-bold tracking-[-0.2px] text-foreground"
              }
              numberOfLines={1}
              onPress={authorPress}
              suppressHighlighting
            >
              {messageDisplayName(message)}
            </Text>
            {isApp ? <AppBadge /> : null}
          </View>
          <Text className="text-xs font-medium text-muted">
            {formatDateTime(message.createdAt)}
          </Text>
        </View>
      </View>
      <View className="gap-[2px]">
        {message.pinned ? <PinnedBadge /> : null}
        <MessageRowBody
          message={message}
          onJumpToMessage={onJumpToMessage}
          onToggleReaction={onToggleReaction}
          showMerlinRunControls={showMerlinRunControls}
        />
      </View>
    </View>
  )
}

function ReplyPreview({
  message,
  onJumpToMessage,
}: {
  message: Message
  onJumpToMessage?: (messageId: string) => void
}) {
  const referenced = message.referencedMessage
  const referencedName = referenced
    ? (referenced.overrideName ??
      referenced.author.displayUsername ??
      referenced.author.name)
    : null
  const canJump = !!referenced && !!onJumpToMessage

  return (
    <Pressable
      accessibilityLabel={
        referencedName
          ? canJump
            ? `Jump to message from ${referencedName}`
            : `Replying to ${referencedName}`
          : "Original message was deleted"
      }
      accessibilityRole={canJump ? "button" : undefined}
      className="mb-one min-h-7 flex-row items-center gap-two"
      disabled={!canJump}
      onPress={() => {
        if (referenced) onJumpToMessage?.(referenced.id)
      }}
    >
      <View className="ml-two h-5 w-px bg-border" />
      {referenced && referencedName ? (
        <Avatar
          avatarColor={referenced.author.avatarColor}
          fallback={getAvatarInitials(referencedName)}
          image={referenced.overrideAvatarUrl ?? referenced.author.image}
          name={referencedName}
          size="xs"
        />
      ) : null}
      <Text className="shrink-0 text-xs font-semibold text-muted">
        {referencedName ?? "Original message was deleted"}
      </Text>
      {referenced?.content ? (
        <Text className="min-w-0 flex-1 text-xs text-muted" numberOfLines={1}>
          {/* Resolve the quoted message's stored `<@uuid>` mention tokens; the
              API attaches the mentions its content references. */}
          {toSearchPreviewText(referenced.content, referenced.mentions ?? [])}
        </Text>
      ) : null}
    </Pressable>
  )
}

function ThreadFooter({
  message,
  onOpenThread,
}: {
  message: Message
  onOpenThread: (message: Message) => void
}) {
  const [muted, background] = useThemeColor(["muted", "background"])
  const summary = message.threadSummary
  if (!summary) return null

  const replyLabel = `${summary.replyCount} ${
    summary.replyCount === 1 ? "reply" : "replies"
  }`

  return (
    <Pressable
      accessibilityLabel={`${replyLabel}. Last reply ${timeAgo(summary.lastReplyAt)}`}
      accessibilityRole="button"
      className="mt-two min-h-9 flex-row items-center gap-two rounded-lor-sm py-one pr-two"
      onPress={() => onOpenThread(message)}
    >
      <View className="flex-row pl-one">
        {summary.participants.slice(0, 3).map((participant, index) => (
          <Avatar
            avatarColor={participant.avatarColor}
            className={index === 0 ? "size-6" : "-ml-two size-6"}
            fallback={getAvatarInitials(participant.name)}
            image={participant.image}
            key={participant.id}
            name={participant.displayUsername ?? participant.name}
            size="xs"
            style={{ borderColor: background, borderWidth: 2 }}
          />
        ))}
      </View>
      <Text className="text-[13px] font-semibold text-accent">
        {replyLabel}
      </Text>
      <Text className="min-w-0 flex-1 text-[13px] text-muted" numberOfLines={1}>
        Last reply {timeAgo(summary.lastReplyAt)}
      </Text>
      <HugeiconsIcon color={muted} icon={ArrowRight01Icon} size={15} />
    </Pressable>
  )
}

export function DatePill({
  label,
  className = "",
}: {
  label: string
  className?: string
}) {
  return (
    <Text
      className={`rounded-full border border-separator bg-background px-[10px] py-[2px] text-xs font-medium text-muted ${className}`}
    >
      {label}
    </Text>
  )
}

export function MessageDateDivider({ date }: { date: string }) {
  return (
    <View className="flex-row items-center py-three">
      <View className="h-px flex-1 bg-separator" />
      <DatePill label={formatDateDivider(date)} />
      <View className="h-px flex-1 bg-separator" />
    </View>
  )
}
