import { MERLIN_USER_ID } from "@repo/db/constants"
import { FlatList, Text, View } from "react-native"
import { MessageContent } from "@/components/message-content"
import { Avatar } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import type { Message } from "@/lib/api-types"

const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000

function displayName(message: Message) {
  return (
    message.overrideName ??
    message.author.displayUsername ??
    message.author.name
  )
}

function avatarInitial(message: Message) {
  return displayName(message).trim().charAt(0).toUpperCase() || "?"
}

function isSameDay(left: string, right: string) {
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

function MessageRow({
  message,
  showHeader,
}: {
  message: Message
  showHeader: boolean
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
            name={displayName(message)}
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
              {displayName(message)}
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
      </View>
    </View>
  )
}

function DateDivider({ date }: { date: string }) {
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

export function MessageList({
  messages,
  isLoading,
  error,
  channelName,
  onRetry,
}: {
  messages: Message[]
  isLoading: boolean
  error: string | null
  channelName: string
  currentUserId?: string
  onRetry: () => void
}) {
  if (isLoading) return <MessageListSkeleton />
  if (error) {
    return (
      <StatePanel
        action={{ label: "Try again", onPress: onRetry }}
        className="flex-1"
        detail={error}
        status="danger"
        title="Messages are unavailable"
      />
    )
  }
  if (messages.length === 0) {
    return (
      <StatePanel
        className="flex-1"
        detail={`This is the beginning of #${channelName}. Say hello to your team.`}
        title={`Welcome to #${channelName}`}
      />
    )
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      data={messages}
      inverted
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(message) => message.id}
      renderItem={({ item, index }) => {
        const older = messages[index + 1]
        const showHeader =
          !older ||
          older.authorId !== item.authorId ||
          new Date(item.createdAt).getTime() -
            new Date(older.createdAt).getTime() >
            MESSAGE_GROUP_WINDOW_MS
        const showDate = !older || !isSameDay(item.createdAt, older.createdAt)
        return (
          <View>
            {showDate ? <DateDivider date={item.createdAt} /> : null}
            <MessageRow message={item} showHeader={showHeader} />
          </View>
        )
      }}
      showsVerticalScrollIndicator={false}
    />
  )
}

function MessageListSkeleton() {
  return (
    <View className="flex-1 gap-six bg-background px-four pt-five">
      {[0, 1, 2, 3, 4].map((item) => (
        <View className="flex-row gap-three" key={item}>
          <Skeleton className="h-10 w-10" />
          <View className="flex-1 gap-two pt-[2px]">
            <Skeleton className="h-[14px] w-[100px] rounded-full" />
            <Skeleton
              className={`${item % 2 ? "w-[62%]" : "w-[82%]"} h-3 rounded-full`}
            />
            {item === 1 ? (
              <Skeleton className="h-3 w-[42%] rounded-full" />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  )
}
