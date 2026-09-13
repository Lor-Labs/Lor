import type { LegendListRef } from "@legendapp/list/react-native"
import { formatDateDivider } from "@repo/utils/date"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, View } from "react-native"
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated"
import {
  ChannelEventRow,
  isCollapsibleChannelEvent,
  type ResolveUserName,
} from "@/components/channel-event-row"
import type { ChatMessageListKeyboardProps } from "@/components/chat-keyboard-layout"
import { MessageActionMenu } from "@/components/message-action-menu"
import {
  areMessagesOnSameDay,
  DatePill,
  MESSAGE_GROUP_WINDOW_MS,
  MessageDateDivider,
  MessageRow,
  messageDisplayName,
} from "@/components/message-row"
import { MobileMessageScroller } from "@/components/mobile-message-scroller"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { useMessageActionPress } from "@/hooks/use-message-action-press"
import type { Message } from "@/lib/api-types"
import { isOptimisticMessage } from "@/lib/messages"

export function MessageList({
  avatarColorByUserId,
  messages,
  isLoading,
  error,
  channelName,
  emptyState,
  onRetry,
  onOpenThread,
  onReply,
  onLoadAround,
  onEdit,
  onDelete,
  onPressAuthor,
  onToggleReaction,
  onTogglePin,
  currentUserId,
  editingMessageId,
  replyingToId,
  focusMessageId,
  keyboardProps,
  listKey,
  resolveUserName,
}: {
  avatarColorByUserId?: ReadonlyMap<string, string>
  messages: Message[]
  isLoading: boolean
  error: string | null
  channelName: string
  emptyState?: { title: string; detail: string }
  onRetry: () => void
  onOpenThread?: (message: Message) => void
  onReply: (message: Message) => void
  onLoadAround?: (messageId: string) => Promise<boolean>
  onEdit?: (message: Message) => void
  onDelete?: (message: Message) => void
  onPressAuthor?: (message: Message) => void
  onToggleReaction?: (messageId: string, emoji: string) => void
  onTogglePin?: (message: Message) => void
  currentUserId?: string
  editingMessageId?: string | null
  replyingToId?: string | null
  focusMessageId?: string | null
  keyboardProps: ChatMessageListKeyboardProps
  listKey: string
  // Resolves event-payload user ids to display names (channel events).
  resolveUserName?: ResolveUserName
}) {
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null)
  const [stickyDate, setStickyDate] = useState<string | null>(null)
  const listRef = useRef<LegendListRef>(null)
  const externalFocusRef = useRef<string | null>(null)
  const scrolledJumpTargetRef = useRef<string | null>(null)
  const orderedMessages = useMemo(() => [...messages].reverse(), [messages])
  const { handleLongPress, highlightedMessageId } =
    useMessageActionPress(setSelectedMessage)

  const handleFirstVisibleItemChanged = useCallback(
    ({ index, item }: { index: number; item: Message }) => {
      setStickyDate(index === 0 ? null : formatDateDivider(item.createdAt))
    },
    []
  )

  const scrollToJumpTarget = useCallback(
    (messageId: string) => {
      const index = orderedMessages.findIndex(
        (message) => message.id === messageId
      )
      const list = listRef.current
      if (index < 0 || !list) return false
      void list.scrollToIndex({
        animated: true,
        index,
        viewPosition: 0.5,
      })
      return true
    },
    [orderedMessages]
  )

  useEffect(() => {
    if (!jumpTargetId) return
    if (
      scrolledJumpTargetRef.current !== jumpTargetId &&
      scrollToJumpTarget(jumpTargetId)
    ) {
      scrolledJumpTargetRef.current = jumpTargetId
    }
  }, [jumpTargetId, scrollToJumpTarget])

  useEffect(() => {
    if (!jumpTargetId) {
      scrolledJumpTargetRef.current = null
      return
    }
    const timeout = setTimeout(() => setJumpTargetId(null), 3500)
    return () => clearTimeout(timeout)
  }, [jumpTargetId])

  const jumpToMessage = useCallback(
    async (messageId: string) => {
      if (messages.some((message) => message.id === messageId)) {
        setJumpTargetId(messageId)
        return
      }
      const loaded = await onLoadAround?.(messageId)
      if (!loaded) {
        setJumpTargetId(null)
        return
      }
      requestAnimationFrame(() => setJumpTargetId(messageId))
    },
    [messages, onLoadAround]
  )

  useEffect(() => {
    if (!focusMessageId) {
      externalFocusRef.current = null
      return
    }
    if (externalFocusRef.current === focusMessageId) return
    externalFocusRef.current = focusMessageId
    void jumpToMessage(focusMessageId)
  }, [focusMessageId, jumpToMessage])

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
        detail={
          emptyState?.detail ??
          `This is the beginning of #${channelName}. Say hello to your team.`
        }
        title={emptyState?.title ?? `Welcome to #${channelName}`}
      />
    )
  }

  const openSelectedThread = onOpenThread
    ? () => {
        if (!selectedMessage) return
        const message = selectedMessage
        setSelectedMessage(null)
        onOpenThread(message)
      }
    : undefined

  const replyToSelectedMessage = () => {
    if (!selectedMessage) return
    const message = selectedMessage
    setSelectedMessage(null)
    onReply(message)
  }

  return (
    <>
      <View className="relative flex-1">
        <MobileMessageScroller
          key={listKey}
          ref={listRef}
          className="flex-1 bg-background"
          data={orderedMessages}
          estimatedItemSize={88}
          initialScrollAtEnd
          isLorResponding={messages.some(
            (message) => message.status === "pending"
          )}
          keyExtractor={(message) => message.id}
          keyboardProps={keyboardProps}
          newestItemKey={orderedMessages.at(-1)?.id}
          onFirstVisibleItemChanged={handleFirstVisibleItemChanged}
          renderItem={({ item, index }) => {
            const older = orderedMessages[index - 1]
            const withinGroupWindow =
              !!older &&
              new Date(item.createdAt).getTime() -
                new Date(older.createdAt).getTime() <=
                MESSAGE_GROUP_WINDOW_MS
            const showDate =
              !older || !areMessagesOnSameDay(item.createdAt, older.createdAt)

            if (item.type === "event") {
              // Consecutive same-kind membership events collapse into one row,
              // rendered on the first of the run (mirrors web message-list).
              // The jump target never chains — scrollToJumpTarget must land on
              // a rendered row.
              const jumpFocusId = jumpTargetId ?? focusMessageId
              const chainsWithOlder =
                isCollapsibleChannelEvent(item) &&
                item.id !== jumpFocusId &&
                !!older &&
                older.type === "event" &&
                older.eventType === item.eventType &&
                areMessagesOnSameDay(item.createdAt, older.createdAt) &&
                withinGroupWindow
              if (chainsWithOlder) return <View />
              const group = [item]
              if (isCollapsibleChannelEvent(item)) {
                for (let j = index + 1; j < orderedMessages.length; j++) {
                  const next = orderedMessages[j]
                  const tail = group[group.length - 1]
                  if (
                    !next ||
                    !tail ||
                    next.id === jumpFocusId ||
                    next.type !== "event" ||
                    next.eventType !== item.eventType ||
                    !areMessagesOnSameDay(next.createdAt, tail.createdAt) ||
                    new Date(next.createdAt).getTime() -
                      new Date(tail.createdAt).getTime() >
                      MESSAGE_GROUP_WINDOW_MS
                  ) {
                    break
                  }
                  group.push(next)
                }
              }
              return (
                <View>
                  {showDate ? (
                    <MessageDateDivider date={item.createdAt} />
                  ) : null}
                  <ChannelEventRow
                    events={group}
                    resolveUserName={resolveUserName}
                  />
                </View>
              )
            }

            const showHeader =
              !older ||
              item.type === "reply" ||
              older.authorId !== item.authorId ||
              !withinGroupWindow ||
              // An event row interrupts the visual group — re-anchor the next
              // message with its header.
              older.type === "event"
            const actionLabel = item.threadSummary
              ? "Open thread"
              : "Reply in thread"
            const canManageMessage =
              Boolean(currentUserId) &&
              item.authorId === currentUserId &&
              !isOptimisticMessage(item)
            const accessibilityActions = [{ label: "Reply", name: "reply" }]
            if (onOpenThread) {
              accessibilityActions.push({
                label: actionLabel,
                name: "open-thread",
              })
            }
            if (canManageMessage && item.content?.trim() && onEdit) {
              accessibilityActions.push({
                label: "Edit message",
                name: "edit",
              })
            }
            if (canManageMessage && onDelete) {
              accessibilityActions.push({
                label: "Delete message",
                name: "delete",
              })
            }

            return (
              <View>
                {showDate ? <MessageDateDivider date={item.createdAt} /> : null}
                <Pressable
                  accessibilityActions={accessibilityActions}
                  accessibilityHint="Opens thread actions"
                  accessibilityLabel={`${messageDisplayName(item)}, ${item.content ?? "Message"}`}
                  delayLongPress={350}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "reply") {
                      onReply(item)
                      return
                    }
                    if (event.nativeEvent.actionName === "open-thread") {
                      onOpenThread?.(item)
                      return
                    }
                    if (event.nativeEvent.actionName === "edit") {
                      onEdit?.(item)
                      return
                    }
                    if (event.nativeEvent.actionName === "delete") {
                      onDelete?.(item)
                    }
                  }}
                  onLongPress={() => handleLongPress(item)}
                >
                  <MessageRow
                    avatarColorByUserId={avatarColorByUserId}
                    message={item}
                    isActionHighlighted={highlightedMessageId === item.id}
                    isHighlighted={
                      jumpTargetId === item.id ||
                      replyingToId === item.id ||
                      editingMessageId === item.id
                    }
                    onJumpToMessage={(messageId) =>
                      void jumpToMessage(messageId)
                    }
                    onOpenThread={onOpenThread}
                    onPressAuthor={onPressAuthor}
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
        onEdit={
          selectedMessage &&
          currentUserId === selectedMessage.authorId &&
          !isOptimisticMessage(selectedMessage) &&
          selectedMessage.content?.trim()
            ? onEdit
            : undefined
        }
        onDelete={
          selectedMessage &&
          currentUserId === selectedMessage.authorId &&
          !isOptimisticMessage(selectedMessage)
            ? onDelete
            : undefined
        }
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
