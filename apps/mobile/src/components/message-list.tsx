import { formatDateDivider } from "@repo/utils/date"
import { useCallback, useEffect, useRef, useState } from "react"
import { FlatList, Pressable, View, type ViewToken } from "react-native"
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated"
import { MessageActionMenu } from "@/components/message-action-menu"
import {
  areMessagesOnSameDay,
  DatePill,
  MESSAGE_GROUP_WINDOW_MS,
  MessageDateDivider,
  MessageRow,
  messageDisplayName,
} from "@/components/message-row"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { useMessageActionPress } from "@/hooks/use-message-action-press"
import type { Message } from "@/lib/api-types"

export function MessageList({
  messages,
  isLoading,
  error,
  channelName,
  onRetry,
  onOpenThread,
  onReply,
  onLoadAround,
  onToggleReaction,
  onTogglePin,
  replyingToId,
}: {
  messages: Message[]
  isLoading: boolean
  error: string | null
  channelName: string
  onRetry: () => void
  onOpenThread: (message: Message) => void
  onReply: (message: Message) => void
  onLoadAround?: (messageId: string) => Promise<boolean>
  onToggleReaction?: (messageId: string, emoji: string) => void
  onTogglePin?: (message: Message) => void
  replyingToId?: string | null
}) {
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null)
  const [stickyDate, setStickyDate] = useState<string | null>(null)
  const listRef = useRef<FlatList<Message>>(null)
  const messageCountRef = useRef(0)
  messageCountRef.current = messages.length
  const { handleLongPress, highlightedMessageId } =
    useMessageActionPress(setSelectedMessage)

  // In an inverted list the highest-index viewable item sits at the visual
  // top; its day is what the floating pill shows. Hidden once the oldest
  // loaded message (whose inline divider marks the start) is on screen.
  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
      let top: ViewToken<Message> | null = null
      for (const token of viewableItems) {
        if (
          token.index != null &&
          (top?.index == null || token.index > top.index)
        ) {
          top = token
        }
      }
      setStickyDate(
        !top || top.index === messageCountRef.current - 1
          ? null
          : formatDateDivider(top.item.createdAt)
      )
    }
  ).current
  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 0,
  }).current

  useEffect(() => {
    if (!jumpTargetId) return
    const index = messages.findIndex((message) => message.id === jumpTargetId)
    if (index < 0) return
    listRef.current?.scrollToIndex({ animated: true, index, viewPosition: 0.5 })
    const timeout = setTimeout(() => setJumpTargetId(null), 3500)
    return () => clearTimeout(timeout)
  }, [jumpTargetId, messages])

  const jumpToMessage = useCallback(
    async (messageId: string) => {
      setJumpTargetId(messageId)
      if (messages.some((message) => message.id === messageId)) return
      const loaded = await onLoadAround?.(messageId)
      if (!loaded) setJumpTargetId(null)
    },
    [messages, onLoadAround]
  )

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

  const replyToSelectedMessage = () => {
    if (!selectedMessage) return
    const message = selectedMessage
    setSelectedMessage(null)
    onReply(message)
  }

  return (
    <>
      <View className="relative flex-1">
        <FlatList
          ref={listRef}
          className="flex-1 bg-background"
          data={messages}
          inverted
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(message) => message.id}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({
              animated: false,
              offset: Math.max(0, index * averageItemLength),
            })
            setTimeout(() => {
              listRef.current?.scrollToIndex({
                animated: true,
                index,
                viewPosition: 0.5,
              })
            }, 80)
          }}
          renderItem={({ item, index }) => {
            const older = messages[index + 1]
            const showHeader =
              !older ||
              item.type === "reply" ||
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
                    { label: "Reply", name: "reply" },
                    { label: actionLabel, name: "open-thread" },
                  ]}
                  accessibilityHint="Opens thread actions"
                  accessibilityLabel={`${messageDisplayName(item)}, ${item.content ?? "Message"}`}
                  delayLongPress={350}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "reply") {
                      onReply(item)
                      return
                    }
                    if (event.nativeEvent.actionName === "open-thread") {
                      onOpenThread(item)
                    }
                  }}
                  onLongPress={() => handleLongPress(item)}
                >
                  <MessageRow
                    message={item}
                    isActionHighlighted={highlightedMessageId === item.id}
                    isHighlighted={
                      jumpTargetId === item.id || replyingToId === item.id
                    }
                    onJumpToMessage={(messageId) =>
                      void jumpToMessage(messageId)
                    }
                    onOpenThread={onOpenThread}
                    onToggleReaction={(message, emoji) =>
                      onToggleReaction?.(message.id, emoji)
                    }
                    showHeader={showHeader}
                  />
                </Pressable>
              </View>
            )
          }}
          showsVerticalScrollIndicator={false}
        />
        {stickyDate ? (
          <Animated.View
            className="absolute inset-x-0 top-two items-center"
            entering={FadeInUp.duration(200)}
            exiting={FadeOutUp.duration(200)}
            pointerEvents="none"
          >
            <DatePill className="shadow-sm" label={stickyDate} />
          </Animated.View>
        ) : null}
      </View>
      <MessageActionMenu
        message={selectedMessage}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedMessage(null)
        }}
        onOpenThread={openSelectedThread}
        onReply={replyToSelectedMessage}
        onToggleReaction={(message, emoji) =>
          onToggleReaction?.(message.id, emoji)
        }
        onTogglePin={onTogglePin}
      />
    </>
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
