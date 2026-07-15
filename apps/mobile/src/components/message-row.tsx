import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { MERLIN_USER_ID } from "@repo/db/constants"
import { timeAgo } from "@repo/utils/date"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"
import { MessageContent } from "@/components/message-content"
import { Avatar } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import type { Message } from "@/lib/api-types"

export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000

export function messageDisplayName(message: Message) {
  return (
    message.overrideName ??
    message.author.displayUsername ??
    message.author.name
  )
}

function avatarInitial(message: Message) {
  return messageDisplayName(message).trim().charAt(0).toUpperCase() || "?"
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

function dateLabel(date: string) {
  return new Date(date).toLocaleDateString([], {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export function MessageRow({
  message,
  showHeader,
  onOpenThread,
}: {
  message: Message
  showHeader: boolean
  onOpenThread?: (message: Message) => void
}) {
  const isMerlin = message.authorId === MERLIN_USER_ID
  const isPending = message.id.startsWith("mobile-")
  const avatarUrl = message.overrideAvatarUrl ?? message.author.image
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })

  return (
    <View
      className={`${showHeader ? "py-three" : "py-[3px]"} flex-row gap-three px-four`}
    >
      <View className="min-w-10 pt-px">
        {showHeader ? (
          <Avatar
            color={isMerlin ? "accent" : "default"}
            fallback={isMerlin ? "M" : avatarInitial(message)}
            image={avatarUrl}
            name={messageDisplayName(message)}
            size="sm"
          />
        ) : null}
      </View>
      <View className="min-w-0 flex-1 gap-[2px]">
        {showHeader ? (
          <View className="flex-row items-baseline gap-two">
            <Text
              className={
                isMerlin
                  ? "text-[15px] font-bold tracking-[-0.1px] text-accent"
                  : "text-[15px] font-bold tracking-[-0.1px] text-foreground"
              }
            >
              {messageDisplayName(message)}
            </Text>
            <Text className="text-xs font-medium text-muted">{time}</Text>
          </View>
        ) : null}
        {isPending ? (
          <Text className="self-end text-[11px] font-semibold text-muted">
            Sending
          </Text>
        ) : null}
        {message.content ? (
          <MessageContent
            content={message.content}
            mentions={message.mentions}
            streaming={isMerlin && message.status === "pending"}
          />
        ) : null}
        {isMerlin && message.status === "pending" && !message.content ? (
          <View
            accessibilityLabel="Merlin is thinking"
            accessibilityLiveRegion="polite"
            className="min-h-6 justify-center"
          >
            <Skeleton className="h-3 w-24 rounded-full" />
          </View>
        ) : null}
        {onOpenThread && message.threadSummary ? (
          <ThreadFooter message={message} onOpenThread={onOpenThread} />
        ) : null}
      </View>
    </View>
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
            className={index === 0 ? "size-6" : "-ml-two size-6"}
            fallback={
              (participant.displayUsername ?? participant.name)
                .trim()
                .charAt(0)
                .toUpperCase() || "?"
            }
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

export function MessageDateDivider({ date }: { date: string }) {
  return (
    <View className="flex-row items-center gap-two px-four py-five">
      <View className="h-px flex-1 bg-separator" />
      <Text className="text-xs font-semibold text-muted">
        {dateLabel(date)}
      </Text>
      <View className="h-px flex-1 bg-separator" />
    </View>
  )
}
