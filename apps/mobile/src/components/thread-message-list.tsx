import { Spinner } from "heroui-native/spinner"
import { useMemo } from "react"
import { FlatList, Text, View } from "react-native"
import {
  areMessagesOnSameDay,
  MESSAGE_GROUP_WINDOW_MS,
  MessageDateDivider,
  MessageRow,
} from "@/components/message-row"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { Message } from "@/lib/api-types"

type ThreadListItem =
  | { kind: "reply"; message: Message; replyIndex: number }
  | { kind: "pagination" }
  | { kind: "count" }
  | { kind: "root"; message: Message }

export function ThreadMessageList({
  root,
  messages,
  totalReplyCount,
  hasOlder,
  isLoadingOlder,
  paginationError,
  onLoadOlder,
}: {
  root: Message
  messages: Message[]
  totalReplyCount: number
  hasOlder: boolean
  isLoadingOlder: boolean
  paginationError: string | null
  onLoadOlder: () => void
}) {
  const items = useMemo<ThreadListItem[]>(() => {
    const next: ThreadListItem[] = messages.map((message, replyIndex) => ({
      kind: "reply",
      message,
      replyIndex,
    }))
    if (hasOlder || isLoadingOlder || paginationError) {
      next.push({ kind: "pagination" })
    }
    next.push({ kind: "count" })
    next.push({ kind: "root", message: root })
    return next
  }, [messages, hasOlder, isLoadingOlder, paginationError, root])

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
      data={items}
      inverted
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => {
        if (item.kind === "reply" || item.kind === "root") {
          return `${item.kind}-${item.message.id}`
        }
        return item.kind
      }}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onEndReached={() => {
        if (hasOlder && !isLoadingOlder) onLoadOlder()
      }}
      onEndReachedThreshold={0.25}
      renderItem={({ item }) => {
        if (item.kind === "root") {
          return (
            <View className="pb-two pt-one">
              <MessageRow message={item.message} showHeader />
            </View>
          )
        }
        if (item.kind === "count") {
          const label = `${totalReplyCount} ${
            totalReplyCount === 1 ? "reply" : "replies"
          }`
          return (
            <View className="flex-row items-center gap-three px-four py-four">
              <Text className="text-xs font-semibold text-muted">{label}</Text>
              <View className="h-px flex-1 bg-separator" />
            </View>
          )
        }
        if (item.kind === "pagination") {
          return (
            <View className="min-h-14 items-center justify-center px-four py-two">
              {isLoadingOlder ? (
                <Spinner accessibilityLabel="Loading older replies" size="sm" />
              ) : paginationError ? (
                <View className="items-center gap-two">
                  <Text className="text-center text-sm text-danger">
                    {paginationError}
                  </Text>
                  <Button onPress={onLoadOlder} size="sm" variant="ghost">
                    Try again
                  </Button>
                </View>
              ) : null}
            </View>
          )
        }

        const { message, replyIndex } = item
        const older = messages[replyIndex + 1]
        const showHeader =
          !older ||
          older.authorId !== message.authorId ||
          new Date(message.createdAt).getTime() -
            new Date(older.createdAt).getTime() >
            MESSAGE_GROUP_WINDOW_MS
        const showDate =
          !older || !areMessagesOnSameDay(message.createdAt, older.createdAt)

        return (
          <View>
            {showDate ? <MessageDateDivider date={message.createdAt} /> : null}
            <MessageRow message={message} showHeader={showHeader} />
          </View>
        )
      }}
      ListHeaderComponent={
        messages.length === 0 ? (
          <View className="items-center px-five py-eight">
            <Text className="text-sm font-medium text-muted">
              No replies yet
            </Text>
          </View>
        ) : null
      }
      showsVerticalScrollIndicator={false}
    />
  )
}

export function ThreadMessageListSkeleton() {
  return (
    <View className="flex-1 gap-five bg-background px-four pt-five">
      <View className="flex-row gap-three">
        <Skeleton className="h-10 w-10" />
        <View className="flex-1 gap-two pt-[2px]">
          <Skeleton className="h-[14px] w-[110px] rounded-full" />
          <Skeleton className="h-3 w-[88%] rounded-full" />
          <Skeleton className="h-3 w-[54%] rounded-full" />
        </View>
      </View>
      <View className="flex-row items-center gap-three py-two">
        <Skeleton className="h-3 w-14 rounded-full" />
        <Skeleton className="h-px flex-1 rounded-full" />
      </View>
      {[0, 1, 2].map((item) => (
        <View className="flex-row gap-three" key={item}>
          <Skeleton className="h-10 w-10" />
          <View className="flex-1 gap-two pt-[2px]">
            <Skeleton className="h-[14px] w-[96px] rounded-full" />
            <Skeleton
              className={`${item % 2 ? "w-[58%]" : "w-[78%]"} h-3 rounded-full`}
            />
          </View>
        </View>
      ))}
    </View>
  )
}
