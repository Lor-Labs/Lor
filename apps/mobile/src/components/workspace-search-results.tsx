import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatDateTime } from "@repo/utils/date"
import { Pressable, Text, View } from "react-native"
import { ChannelRow } from "@/components/channel-list"
import { Avatar } from "@/components/ui/avatar"
import { PressableRow } from "@/components/ui/pressable-row"
import { PressableScale } from "@/components/ui/pressable-scale"
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
  const displayName = message.author.name ?? "Unknown member"
  const preview = toSearchPreviewText(message.content, message.mentions)

  return (
    <PressableRow
      accessibilityActions={
        onPressAuthor
          ? [
              {
                name: "viewAuthorProfile",
                label: `Open ${displayName}'s profile`,
              },
            ]
          : undefined
      }
      accessibilityHint="Opens the channel and focuses this message"
      accessibilityLabel={`Message from ${displayName} in ${message.channelName}: ${preview}`}
      accessibilityRole="button"
      className="flex-row gap-three px-two py-two"
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "viewAuthorProfile") {
          onPressAuthor?.(message)
        }
      }}
      onPress={() => onPress(message)}
    >
      <Pressable
        accessibilityElementsHidden
        accessible={false}
        className="active:opacity-70"
        disabled={!onPressAuthor}
        hitSlop={4}
        importantForAccessibility="no-hide-descendants"
        onPress={() => onPressAuthor?.(message)}
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
            {message.sessionTitle ? ` · ${message.sessionTitle}` : ""}
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
    </PressableRow>
  )
}

// Same heading as the Home list's folds, so the two views of this screen
// read as one.
function ResultsHeading({ title, count }: { title: string; count?: number }) {
  return (
    <View className="min-h-9 flex-row items-center gap-[6px] px-two">
      <Text className="text-[13px] font-semibold leading-[18px] text-muted">
        {title}
      </Text>
      {count === undefined ? null : (
        <Text
          className="text-[13px] leading-[18px] text-muted"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {count}
        </Text>
      )}
    </View>
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
    <View className="gap-three pb-seven">
      {channels.length > 0 ? (
        <View>
          <ResultsHeading title="Channels" />
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
        <ResultsHeading
          count={
            !isSearching && search.results.length > 0
              ? search.itemsTotal
              : undefined
          }
          title="Messages"
        />

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
              <PressableScale
                accessibilityRole="button"
                className="mx-two my-two items-center rounded-lor-md border border-border py-three"
                onPress={search.loadMore}
                scale={0.98}
              >
                <Text className="text-sm font-semibold text-foreground">
                  Show more results
                </Text>
              </PressableScale>
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
