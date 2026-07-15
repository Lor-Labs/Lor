import MessageCircleReplyIcon from "@hugeicons/core-free-icons/MessageCircleReplyIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Menu } from "heroui-native/menu"
import { useState } from "react"
import { FlatList, Pressable, Text, View } from "react-native"
import {
  areMessagesOnSameDay,
  MESSAGE_GROUP_WINDOW_MS,
  MessageDateDivider,
  MessageRow,
  messageDisplayName,
} from "@/components/message-row"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import type { Message } from "@/lib/api-types"

export function MessageList({
  messages,
  isLoading,
  error,
  channelName,
  onRetry,
  onOpenThread,
}: {
  messages: Message[]
  isLoading: boolean
  error: string | null
  channelName: string
  onRetry: () => void
  onOpenThread: (message: Message) => void
}) {
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)

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

  const openSelectedThread = () => {
    if (!selectedMessage) return
    const message = selectedMessage
    setSelectedMessage(null)
    onOpenThread(message)
  }

  return (
    <>
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
          const showDate =
            !older || !areMessagesOnSameDay(item.createdAt, older.createdAt)
          const actionLabel = item.threadSummary
            ? "Open thread"
            : "Reply in thread"

          return (
            <View>
              {showDate ? <MessageDateDivider date={item.createdAt} /> : null}
              <Pressable
                accessibilityActions={[
                  { label: actionLabel, name: "open-thread" },
                ]}
                accessibilityHint="Opens thread actions"
                accessibilityLabel={`${messageDisplayName(item)}, ${item.content ?? "Message"}`}
                delayLongPress={350}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "open-thread") {
                    setSelectedMessage(item)
                  }
                }}
                onLongPress={() => setSelectedMessage(item)}
              >
                <MessageRow
                  message={item}
                  onOpenThread={onOpenThread}
                  showHeader={showHeader}
                />
              </Pressable>
            </View>
          )
        }}
        showsVerticalScrollIndicator={false}
      />
      <ThreadActionMenu
        message={selectedMessage}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedMessage(null)
        }}
        onOpenThread={openSelectedThread}
      />
    </>
  )
}

function ThreadActionMenu({
  message,
  onOpenChange,
  onOpenThread,
}: {
  message: Message | null
  onOpenChange: (isOpen: boolean) => void
  onOpenThread: () => void
}) {
  const foreground = useThemeColor("foreground")
  const actionLabel = message?.threadSummary ? "Open thread" : "Reply in thread"

  return (
    <Menu
      isOpen={message !== null}
      onOpenChange={onOpenChange}
      presentation="bottom-sheet"
    >
      <Menu.Portal unstable_accessibilityContainerViewIsModal>
        <Menu.Overlay />
        <Menu.Content
          contentContainerClassName="gap-two px-three pb-five"
          presentation="bottom-sheet"
        >
          {message ? (
            <View className="gap-one px-two pb-three pt-one">
              <Text className="text-sm font-semibold text-foreground">
                {messageDisplayName(message)}
              </Text>
              <Text className="text-sm leading-5 text-muted" numberOfLines={3}>
                {message.content ?? "Message"}
              </Text>
            </View>
          ) : null}
          <Menu.Item className="min-h-14" onPress={onOpenThread}>
            <HugeiconsIcon
              color={foreground}
              icon={MessageCircleReplyIcon}
              size={20}
            />
            <Menu.ItemTitle>{actionLabel}</Menu.ItemTitle>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

export function MessageListSkeleton() {
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
