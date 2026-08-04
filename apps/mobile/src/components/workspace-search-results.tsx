import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatDateTime } from "@repo/utils/date"
import { Pressable, Text, View } from "react-native"
import { ChannelRow } from "@/components/channel-list"
import { Avatar } from "@/components/ui/avatar"
import { SectionLabel } from "@/components/ui/section-label"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { useUnread } from "@/context/unread-context"
import type { useMessageSearch } from "@/hooks/use-message-search"
import type { Channel, ChannelSearchResult } from "@/lib/api-types"
import { toSearchPreviewText } from "@/lib/message-markdown"

function MessageResultRow({
  message,
  onPress,
  onPressAuthor,
}: {
  message: ChannelSearchResult
  onPress: (message: ChannelSearchResult) => void
  onPressAuthor?: (message: ChannelSearchResult) => void
}) {
  const displayName =
    message.author.displayUsername ?? message.author.name ?? "Unknown member"
  const preview = toSearchPreviewText(message.content, message.mentions)

  return (
    <Pressable
      accessibilityHint="Opens the channel and focuses this message"
      accessibilityLabel={`Message from ${displayName} in ${message.channelName}: ${preview}`}
      accessibilityRole="button"
      className="flex-row gap-three rounded-lor-sm px-two py-two active:bg-surface-secondary"
      onPress={() => onPress(message)}
    >
      <Pressable
        accessibilityHint="Opens their profile"
        accessibilityLabel={`${displayName}'s profile`}
        accessibilityRole="button"
        className="active:opacity-70"
        disabled={!onPressAuthor}
        hitSlop={4}
        onPress={onPressAuthor ? () => onPressAuthor(message) : undefined}
      >
        <Avatar
          avatarColor={message.author.avatarColor}
          fallback={getAvatarInitials(message.author.name)}
          image={message.author.image}
          name={displayName}
          size="sm"
        />
      </Pressable>
      <View className="min-w-0 flex-1 gap-px">
        <View className="flex-row items-baseline gap-two">
          <Text
            className="shrink text-[14px] font-semibold text-foreground"
            numberOfLines={1}
          >
            {displayName}
          </Text>
          <Text
            className="min-w-0 flex-1 text-[11px] font-medium text-muted"
            numberOfLines={1}
          >
            in #{message.channelName}
          </Text>
          <Text className="text-[11px] text-muted">
            {formatDateTime(message.createdAt)}
          </Text>
        </View>
        <Text
          className="text-[13px] leading-[18px] text-muted"
          numberOfLines={2}
        >
          {preview}
        </Text>
      </View>
    </Pressable>
  )
}

export function WorkspaceSearchResults({
  channels,
  onPressChannel,
  onPressMessage,
  onPressMessageAuthor,
  query,
  search,
}: {
  channels: Channel[]
  onPressChannel: (channel: Channel) => void
  onPressMessage: (message: ChannelSearchResult) => void
  onPressMessageAuthor?: (message: ChannelSearchResult) => void
  query: string
  search: ReturnType<typeof useMessageSearch>
}) {
  const { getUnreadCount, getMentionCount } = useUnread()
  const isSearching = search.isDebouncing || search.isLoading
  const nothingFound =
    channels.length === 0 &&
    search.results.length === 0 &&
    !isSearching &&
    !search.error

  if (nothingFound) {
    return (
      <View className="items-center gap-one px-eight py-eight">
        <Text className="text-lg font-bold text-foreground">
          No results found
        </Text>
        <Text className="text-center text-sm leading-5 text-muted">
          Nothing matches “{query}” across your channels and messages.
        </Text>
      </View>
    )
  }

  return (
    <View className="gap-four pb-seven">
      {channels.length > 0 ? (
        <View>
          <View className="min-h-8 flex-row items-center px-two">
            <SectionLabel>Channels</SectionLabel>
          </View>
          {channels.map((channel) => (
            <ChannelRow
              channel={channel}
              key={channel.id}
              mentionCount={getMentionCount(channel.id)}
              onPress={onPressChannel}
              unread={getUnreadCount(channel.id) > 0}
            />
          ))}
        </View>
      ) : null}

      <View>
        <View className="min-h-8 flex-row items-center gap-two px-two">
          <SectionLabel>Messages</SectionLabel>
          {!isSearching && search.results.length > 0 ? (
            <Text className="text-[11px] font-semibold text-muted">
              {search.itemsTotal}
            </Text>
          ) : null}
        </View>

        {isSearching ? (
          <MessageResultsSkeleton />
        ) : search.error && search.results.length === 0 ? (
          <StatePanel
            action={{ label: "Try again", onPress: search.retry }}
            className="px-two"
            detail={search.error}
            status="danger"
            title="Search is unavailable"
          />
        ) : search.results.length === 0 ? (
          <Text className="px-two py-two text-sm leading-5 text-muted">
            No messages match “{query}”.
          </Text>
        ) : (
          <View>
            {search.results.map((message) => (
              <MessageResultRow
                key={message.id}
                message={message}
                onPress={onPressMessage}
                onPressAuthor={onPressMessageAuthor}
              />
            ))}
            {search.isLoadingMore ? (
              <MessageResultsSkeleton rows={2} />
            ) : search.nextPage != null ? (
              <Pressable
                accessibilityRole="button"
                className="mx-two my-two items-center rounded-lor-sm border border-border py-three active:bg-surface-secondary"
                onPress={search.loadMore}
              >
                <Text className="text-sm font-semibold text-foreground">
                  Show more results
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </View>
  )
}

function MessageResultsSkeleton({ rows = 4 }: { rows?: number }) {
  const items = Array.from({ length: rows }, (_, index) => index)
  return (
    <View className="gap-one">
      {items.map((row) => (
        <View className="flex-row gap-three px-two py-two" key={row}>
          <Skeleton className="size-9 rounded-full" />
          <View className="flex-1 gap-two pt-one">
            <Skeleton className="h-3 w-[46%] rounded-full" />
            <Skeleton
              className={`${row % 2 ? "w-[64%]" : "w-[86%]"} h-3 rounded-full`}
            />
          </View>
        </View>
      ))}
    </View>
  )
}
