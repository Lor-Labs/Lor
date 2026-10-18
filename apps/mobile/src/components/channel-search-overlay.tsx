import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import ThreadIcon from "@hugeicons/core-free-icons/ThreadIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatDateTime } from "@repo/utils/date"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useEffect, useRef, useState } from "react"
import {
  FlatList,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { MessageContent } from "@/components/message-content"
import { Avatar } from "@/components/ui/avatar"
import { IconButton } from "@/components/ui/icon-button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { useMessageSearch } from "@/hooks/use-message-search"
import type { ChannelSearchResult } from "@/lib/api-types"
import { toSearchPreviewText } from "@/lib/message-markdown"

export function ChannelSearchOverlay({
  avatarColorByUserId,
  channelId,
  channelName,
  onClose,
  onSelectMessage,
  visible,
  workspaceSlug,
}: {
  avatarColorByUserId?: ReadonlyMap<string, string>
  channelId: string
  channelName: string
  onClose: () => void
  onSelectMessage: (message: ChannelSearchResult) => void
  visible: boolean
  workspaceSlug: string
}) {
  const [query, setQuery] = useState("")
  const inputRef = useRef<TextInput>(null)
  const [foreground, muted, accent] = useThemeColor([
    "foreground",
    "muted",
    "accent",
  ])
  const search = useMessageSearch({ channelId, query, workspaceSlug })
  const hasQuery = query.trim().length > 0
  const isSearching = search.isDebouncing || search.isLoading

  useEffect(() => {
    if (!visible) {
      setQuery("")
      return
    }

    const timeout = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(timeout)
  }, [visible])

  const close = () => {
    Keyboard.dismiss()
    void KeyboardController.dismiss().catch(() => undefined)
    onClose()
  }

  const renderResult = ({ item }: { item: ChannelSearchResult }) => {
    const displayName = item.author.name ?? "Unknown member"
    const preview = toSearchPreviewText(item.content, item.mentions)

    return (
      <Pressable
        accessibilityHint={
          item.sessionTitle
            ? "Opens the session containing this message"
            : item.threadRootId
              ? "Opens the thread containing this message"
              : "Returns to the channel and focuses this message"
        }
        accessibilityLabel={`Message from ${displayName}${item.sessionTitle ? ` in session ${item.sessionTitle}` : item.threadRootId ? " in a thread" : ""}: ${preview}`}
        accessibilityRole="button"
        className="mx-three flex-row gap-three border-b border-separator px-one py-three active:bg-surface-secondary"
        onPress={() => {
          Keyboard.dismiss()
          void KeyboardController.dismiss().catch(() => undefined)
          onSelectMessage(item)
        }}
      >
        <Avatar
          avatarColor={
            item.author.avatarColor ?? avatarColorByUserId?.get(item.author.id)
          }
          fallback={getAvatarInitials(item.author.name)}
          image={item.author.image}
          name={displayName}
          size="sm"
        />
        <View className="min-w-0 flex-1 gap-one">
          <View className="flex-row items-baseline gap-two">
            <Text
              className="min-w-0 flex-1 text-[15px] font-bold text-foreground"
              numberOfLines={1}
            >
              {displayName}
            </Text>
            <Text className="text-xs font-medium text-muted">
              {formatDateTime(item.createdAt)}
            </Text>
          </View>
          {item.threadRootId ? (
            <View className="flex-row items-center gap-one">
              <HugeiconsIcon color={muted} icon={ThreadIcon} size={12} />
              <Text
                className="min-w-0 shrink text-xs font-medium text-muted"
                numberOfLines={1}
              >
                {item.sessionTitle ?? "In thread"}
              </Text>
            </View>
          ) : null}
          <View className="max-h-[66px] overflow-hidden" pointerEvents="none">
            <MessageContent content={item.content} mentions={item.mentions} />
          </View>
        </View>
      </Pressable>
    )
  }

  if (!visible) return null

  return (
    <View accessibilityViewIsModal className="flex-1 bg-background">
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Close channel search"
          onPress={close}
          variant="ghost"
        >
          <Text className="text-[28px] font-light leading-[28px] text-foreground">
            ×
          </Text>
        </IconButton>
        <View className="h-11 min-w-0 flex-1 flex-row items-center gap-two rounded-lor-sm border border-border bg-surface-secondary px-three">
          <HugeiconsIcon color={muted} icon={Search01Icon} size={18} />
          <TextInput
            ref={inputRef}
            accessibilityLabel={`Search #${channelName}`}
            autoCapitalize="none"
            autoCorrect={false}
            className="h-full min-w-0 flex-1 p-0 text-[16px] text-foreground"
            onChangeText={setQuery}
            placeholder={`Search #${channelName}`}
            placeholderTextColor={muted}
            returnKeyType="search"
            selectionColor={accent}
            value={query}
          />
          {hasQuery ? (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              className="size-7 items-center justify-center rounded-lor-sm active:bg-default"
              hitSlop={6}
              onPress={() => {
                setQuery("")
                inputRef.current?.focus()
              }}
            >
              <Text className="text-xl font-light leading-5 text-muted">×</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {!hasQuery ? (
        <View className="flex-1 items-center justify-center gap-three px-eight pb-20">
          <View className="size-14 items-center justify-center rounded-lor-md bg-surface-secondary">
            <HugeiconsIcon color={foreground} icon={Search01Icon} size={24} />
          </View>
          <View className="items-center gap-one">
            <Text className="text-lg font-bold text-foreground">
              Search #{channelName}
            </Text>
            <Text className="text-center text-sm leading-5 text-muted">
              Find messages in this channel by words or phrases.
            </Text>
          </View>
        </View>
      ) : isSearching ? (
        <SearchResultsSkeleton />
      ) : search.error && search.results.length === 0 ? (
        <StatePanel
          action={{ label: "Try again", onPress: search.retry }}
          className="flex-1"
          detail={search.error}
          status="danger"
          title="Search is unavailable"
        />
      ) : search.results.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-one px-eight pb-20">
          <Text className="text-lg font-bold text-foreground">
            No messages found
          </Text>
          <Text className="text-center text-sm leading-5 text-muted">
            Try a different word or phrase in #{channelName}.
          </Text>
        </View>
      ) : (
        <FlatList
          contentContainerClassName="pb-eight"
          data={search.results}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.id}
          ListFooterComponent={
            search.isLoadingMore ? (
              <View className="h-14 items-center justify-center">
                <Spinner accessibilityLabel="Loading more results" size="sm" />
              </View>
            ) : search.error ? (
              <Pressable
                accessibilityRole="button"
                className="mx-four my-three items-center rounded-lor-sm border border-border py-three active:bg-surface-secondary"
                onPress={search.retry}
              >
                <Text className="text-sm font-semibold text-foreground">
                  Try loading results again
                </Text>
              </Pressable>
            ) : null
          }
          ListHeaderComponent={
            <Text className="px-four pb-one pt-three text-xs font-semibold uppercase tracking-[0.8px] text-muted">
              {search.itemsTotal === 1
                ? "1 result"
                : `${search.itemsTotal} results`}
            </Text>
          }
          onEndReached={search.loadMore}
          onEndReachedThreshold={0.35}
          renderItem={renderResult}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

function SearchResultsSkeleton() {
  return (
    <View className="flex-1 gap-one px-four pt-four">
      {[0, 1, 2, 3, 4].map((item) => (
        <View
          className="flex-row gap-three border-b border-separator py-three"
          key={item}
        >
          <Skeleton className="size-10 rounded-full" />
          <View className="flex-1 gap-two pt-one">
            <Skeleton className="h-3 w-[42%] rounded-full" />
            <Skeleton
              className={`${item % 2 ? "w-[68%]" : "w-[88%]"} h-3 rounded-full`}
            />
            {item % 2 ? null : (
              <Skeleton className="h-3 w-[54%] rounded-full" />
            )}
          </View>
        </View>
      ))}
    </View>
  )
}
