import type { LegendListRef } from "@legendapp/list/react-native"
import { formatDateDivider } from "@repo/utils/date"
import { Spinner } from "heroui-native/spinner"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated"
import type { ChatMessageListKeyboardProps } from "@/components/chat-keyboard-layout"
import { MessageActionMenu } from "@/components/message-action-menu"
import {
  areMessagesOnSameDay,
  DatePill,
  MESSAGE_GROUP_WINDOW_MS,
  MessageDateDivider,
  MessageRow,
  messageDisplayName,
  ThreadRootMessage,
} from "@/components/message-row"
import { MobileMessageScroller } from "@/components/mobile-message-scroller"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useMessageActionPress } from "@/hooks/use-message-action-press"
import type { Message } from "@/lib/api-types"
import { isOptimisticMessage } from "@/lib/messages"

type ThreadListItem =
  | { kind: "reply"; message: Message; replyIndex: number }
  | { kind: "pagination" }
  | { kind: "count" }
  | { kind: "root"; message: Message }

export function ThreadMessageList({
  avatarColorByUserId,
  root,
  messages,
  totalReplyCount,
  hasOlder,
  isRefreshing,
  isLoadingOlder,
  paginationError,
  onLoadOlder,
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
}: {
  avatarColorByUserId?: ReadonlyMap<string, string>
  root: Message
  messages: Message[]
  totalReplyCount: number
  hasOlder: boolean
  isRefreshing: boolean
  isLoadingOlder: boolean
  paginationError: string | null
  onLoadOlder: () => void
  onReply: (message: Message) => void
  onLoadAround: (messageId: string) => Promise<boolean>
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
}) {
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null)
  const [stickyDate, setStickyDate] = useState<string | null>(null)
  const listRef = useRef<LegendListRef>(null)
  const externalFocusRef = useRef<string | null>(null)
  const { handleLongPress, highlightedMessageId } =
    useMessageActionPress(setSelectedMessage)

  const orderedMessages = useMemo(() => [...messages].reverse(), [messages])
  const items = useMemo<ThreadListItem[]>(() => {
    // A call chat's root is the session itself, with nothing to read.
    const next: ThreadListItem[] =
      root.type === "voice_session"
        ? []
        : [{ kind: "root", message: root }, { kind: "count" }]
    if (hasOlder || isLoadingOlder || paginationError) {
      next.push({ kind: "pagination" })
    }
    next.push(
      ...orderedMessages.map((message, replyIndex) => ({
        kind: "reply" as const,
        message,
        replyIndex,
      }))
    )
    return next
  }, [orderedMessages, hasOlder, isLoadingOlder, paginationError, root])

  const handleFirstVisibleItemChanged = useCallback(
    ({ item }: { item: ThreadListItem }) => {
      setStickyDate(
        item.kind === "reply" ? formatDateDivider(item.message.createdAt) : null
      )
    },
    []
  )

  const openingPositionRef = useRef<{
    listKey: string
    position?: { index: number; viewOffset: number; viewPosition: number }
    resolved: boolean
  } | null>(null)
  if (openingPositionRef.current?.listKey !== listKey) {
    openingPositionRef.current = { listKey, resolved: false }
  }
  if (!openingPositionRef.current.resolved) {
    let latestCompletedLorReply: Message | undefined
    for (let index = orderedMessages.length - 1; index >= 0; index -= 1) {
      const message = orderedMessages[index]
      if (
        message &&
        message.status !== "pending" &&
        message.lorTriggerMessageId
      ) {
        latestCompletedLorReply = message
        break
      }
    }
    const triggerId = latestCompletedLorReply?.lorTriggerMessageId
    const anchorIndex = triggerId
      ? items.findIndex(
          (item) =>
            (item.kind === "root" || item.kind === "reply") &&
            item.message.id === triggerId
        )
      : -1
    openingPositionRef.current = {
      listKey,
      position:
        anchorIndex >= 0
          ? { index: anchorIndex, viewOffset: 64, viewPosition: 0 }
          : undefined,
      resolved: anchorIndex >= 0 || !isRefreshing,
    }
  }
  const openingPosition = openingPositionRef.current?.position
  const openingScrollerKey = openingPosition
    ? `${listKey}:anchor-${openingPosition.index}`
    : `${listKey}:end`

  useEffect(() => {
    if (!jumpTargetId) return
    const index = items.findIndex(
      (item) =>
        (item.kind === "reply" || item.kind === "root") &&
        item.message.id === jumpTargetId
    )
    if (index < 0) return
    void listRef.current?.scrollToIndex({
      animated: true,
      index,
      viewPosition: 0.5,
    })
    const timeout = setTimeout(() => setJumpTargetId(null), 3500)
    return () => clearTimeout(timeout)
  }, [items, jumpTargetId])

  const replyToSelectedMessage = () => {
    if (!selectedMessage) return
    const message = selectedMessage
    setSelectedMessage(null)
    onReply(message)
  }

  const jumpToMessage = useCallback(
    async (messageId: string) => {
      setJumpTargetId(messageId)
      const alreadyLoaded = items.some(
        (item) =>
          (item.kind === "reply" || item.kind === "root") &&
          item.message.id === messageId
      )
      if (alreadyLoaded) return
      const loaded = await onLoadAround(messageId)
      if (!loaded) setJumpTargetId(null)
    },
    [items, onLoadAround]
  )

  useEffect(() => {
    if (!focusMessageId || externalFocusRef.current === focusMessageId) return
    externalFocusRef.current = focusMessageId
    void jumpToMessage(focusMessageId)
  }, [focusMessageId, jumpToMessage])

  return (
    <>
      <View className="relative flex-1">
        <MobileMessageScroller
          key={openingScrollerKey}
          ref={listRef}
          className="flex-1 bg-background"
          data={items}
          estimatedItemSize={96}
          getItemType={(item) => item.kind}
          initialScrollAtEnd={!openingPosition}
          initialScrollIndex={openingPosition}
          isLorResponding={
            root.status === "pending" ||
            messages.some((message) => message.status === "pending")
          }
          keyboardProps={keyboardProps}
          keyExtractor={(item) => {
            if (item.kind === "reply" || item.kind === "root") {
              return `${item.kind}-${item.message.id}`
            }
            return item.kind
          }}
          newestItemKey={orderedMessages.at(-1)?.id ?? `root-${root.id}`}
          onFirstVisibleItemChanged={handleFirstVisibleItemChanged}
          onStartReached={() => {
            // Don't auto-retry after a failed page — that's the Try again button.
            if (hasOlder && !isLoadingOlder && !paginationError) onLoadOlder()
          }}
          onStartReachedThreshold={0.25}
          renderItem={({ item }) => {
            if (item.kind === "root") {
              const canManageMessage =
                Boolean(currentUserId) &&
                item.message.authorId === currentUserId &&
                !isOptimisticMessage(item.message)
              const accessibilityActions = [{ label: "Reply", name: "reply" }]
              if (canManageMessage && item.message.content?.trim() && onEdit) {
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
                <Pressable
                  accessibilityActions={accessibilityActions}
                  accessibilityHint="Opens message actions"
                  accessibilityLabel={`Message from ${messageDisplayName(item.message)}`}
                  delayLongPress={350}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "reply") {
                      onReply(item.message)
                      return
                    }
                    if (event.nativeEvent.actionName === "edit") {
                      onEdit?.(item.message)
                      return
                    }
                    if (event.nativeEvent.actionName === "delete") {
                      onDelete?.(item.message)
                    }
                  }}
                  onLongPress={() => handleLongPress(item.message)}
                >
                  <ThreadRootMessage
                    avatarColorByUserId={avatarColorByUserId}
                    isActionHighlighted={
                      highlightedMessageId === item.message.id
                    }
                    isHighlighted={
                      jumpTargetId === item.message.id ||
                      replyingToId === item.message.id ||
                      editingMessageId === item.message.id
                    }
                    message={item.message}
                    onJumpToMessage={(messageId) =>
                      void jumpToMessage(messageId)
                    }
                    onPressAuthor={onPressAuthor}
                    onToggleReaction={(message, emoji) =>
                      onToggleReaction?.(message.id, emoji)
                    }
                    showLorRunControls={false}
                  />
                </Pressable>
              )
            }
            if (item.kind === "count") {
              const label = `${totalReplyCount} ${
                totalReplyCount === 1 ? "reply" : "replies"
              }`
              return (
                <View className="flex-row items-center gap-three px-four pb-two pt-three">
                  <Text className="text-xs font-medium text-muted">
                    {label}
                  </Text>
                  <View className="h-px flex-1 bg-separator" />
                </View>
              )
            }
            if (item.kind === "pagination") {
              return (
                <View className="min-h-14 items-center justify-center px-four py-two">
                  {isLoadingOlder ? (
                    <Spinner
                      accessibilityLabel="Loading older replies"
                      size="sm"
                    />
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
            const older = orderedMessages[replyIndex - 1]
            const showHeader =
              !older ||
              message.type === "reply" ||
              older.authorId !== message.authorId ||
              new Date(message.createdAt).getTime() -
                new Date(older.createdAt).getTime() >
                MESSAGE_GROUP_WINDOW_MS
            // The oldest loaded reply compares against the root only once all
            // older replies are loaded — unloaded days may sit in between.
            const showDate = older
              ? !areMessagesOnSameDay(message.createdAt, older.createdAt)
              : !hasOlder &&
                !areMessagesOnSameDay(message.createdAt, root.createdAt)
            const canManageMessage =
              Boolean(currentUserId) &&
              message.authorId === currentUserId &&
              !isOptimisticMessage(message)
            const accessibilityActions = [{ label: "Reply", name: "reply" }]
            if (canManageMessage && message.content?.trim() && onEdit) {
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
              <Pressable
                accessibilityActions={accessibilityActions}
                accessibilityHint="Opens message actions"
                accessibilityLabel={`Message from ${messageDisplayName(message)}`}
                delayLongPress={350}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "reply") {
                    onReply(message)
                    return
                  }
                  if (event.nativeEvent.actionName === "edit") {
                    onEdit?.(message)
                    return
                  }
                  if (event.nativeEvent.actionName === "delete") {
                    onDelete?.(message)
                  }
                }}
                onLongPress={() => handleLongPress(message)}
              >
                <View>
                  {showDate ? (
                    <MessageDateDivider date={message.createdAt} />
                  ) : null}
                  <MessageRow
                    avatarColorByUserId={avatarColorByUserId}
                    isActionHighlighted={highlightedMessageId === message.id}
                    isHighlighted={
                      jumpTargetId === message.id ||
                      replyingToId === message.id ||
                      editingMessageId === message.id
                    }
                    message={message}
                    onJumpToMessage={(messageId) =>
                      void jumpToMessage(messageId)
                    }
                    onPressAuthor={onPressAuthor}
                    onToggleReaction={(message, emoji) =>
                      onToggleReaction?.(message.id, emoji)
                    }
                    showLorRunControls={false}
                    showHeader={showHeader}
                  />
                </View>
              </Pressable>
            )
          }}
          ListFooterComponent={
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

export function ThreadMessageListSkeleton() {
  return (
    <View className="flex-1 gap-five bg-background px-four pt-five">
      <View className="gap-three">
        <View className="flex-row items-center gap-three">
          <Skeleton className="h-12 w-12" />
          <View className="gap-two">
            <Skeleton className="h-[14px] w-[110px] rounded-full" />
            <Skeleton className="h-3 w-[130px] rounded-full" />
          </View>
        </View>
        <View className="gap-two">
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
