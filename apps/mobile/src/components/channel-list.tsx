import ChevronDownIcon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon"
import Folder02Icon from "@hugeicons/core-free-icons/Folder02Icon"
import HashtagIcon from "@hugeicons/core-free-icons/HashtagIcon"
import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon"
import VolumeHighIcon from "@hugeicons/core-free-icons/VolumeHighIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import * as Haptics from "expo-haptics"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { SectionLabel } from "@/components/ui/section-label"
import { Skeleton } from "@/components/ui/skeleton"
import { useUnread } from "@/context/unread-context"
import type { Channel, ChannelCategory } from "@/lib/api-types"

function MentionBadge({ count }: { count: number }) {
  return (
    <View className="h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5">
      <Text className="text-[11px] font-bold leading-[13px] text-danger-foreground">
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  )
}

export function ChannelRow({
  channel,
  mentionCount,
  onLongPress,
  onPress,
  unread,
}: {
  channel: Channel
  mentionCount: number
  onLongPress?: (channel: Channel) => void
  onPress: (channel: Channel) => void
  unread: boolean
}) {
  const [foreground, muted] = useThemeColor(["foreground", "muted"])
  const isVoice = channel.type === "voice"
  // Standalone private channels wear a lock instead of their type glyph;
  // project channels don't — the project boundary communicates the audience.
  const isPrivate = channel.audience === "members" && channel.parentId === null
  const emphasized = unread || mentionCount > 0

  return (
    <Pressable
      accessibilityHint={
        channel.topic ? channel.topic : "Opens this channel's messages"
      }
      accessibilityLabel={`Open ${channel.name ?? "untitled"}${
        mentionCount > 0
          ? `, ${mentionCount} ${mentionCount === 1 ? "mention" : "mentions"}`
          : unread
            ? ", unread messages"
            : ""
      }`}
      accessibilityActions={
        onLongPress
          ? [{ label: "Channel options", name: "channel-options" }]
          : undefined
      }
      accessibilityRole="button"
      className="min-h-[42px] flex-row items-center gap-two rounded-lor-sm px-two active:bg-surface-secondary"
      onAccessibilityAction={
        onLongPress
          ? (event) => {
              if (event.nativeEvent.actionName === "channel-options") {
                onLongPress(channel)
              }
            }
          : undefined
      }
      onLongPress={
        onLongPress
          ? () => {
              void Haptics.selectionAsync()
              onLongPress(channel)
            }
          : undefined
      }
      onPress={() => onPress(channel)}
    >
      {emphasized ? (
        <View className="absolute bottom-0 left-0 top-0 justify-center">
          <View className="h-2.5 w-[3px] rounded-full bg-foreground" />
        </View>
      ) : null}
      <View className="size-7 items-center justify-center">
        <HugeiconsIcon
          color={emphasized ? foreground : muted}
          icon={
            isPrivate
              ? SquareLock02Icon
              : isVoice
                ? VolumeHighIcon
                : HashtagIcon
          }
          size={19}
          strokeWidth={emphasized ? 2 : 1.8}
        />
      </View>
      <Text
        className={`min-w-0 flex-1 text-[15px] leading-5 ${
          emphasized
            ? "font-semibold text-foreground"
            : "font-medium text-muted"
        }`}
        numberOfLines={1}
      >
        {channel.name ?? "untitled"}
      </Text>
      {mentionCount > 0 ? <MentionBadge count={mentionCount} /> : null}
    </Pressable>
  )
}

function ChannelSection({
  channels,
  collapsed,
  hasActivity,
  id,
  isProject = false,
  onToggle,
  renderRow,
  title,
}: {
  channels: Channel[]
  collapsed: boolean
  hasActivity: (channelId: string) => boolean
  id: string
  isProject?: boolean
  onToggle: (id: string) => void
  renderRow: (channel: Channel) => ReactNode
  title: string
}) {
  const muted = useThemeColor("muted")
  if (channels.length === 0) return null

  const expanded = !collapsed
  // Collapsing a category keeps its unread channels visible (Discord behavior)
  const visibleChannels = expanded
    ? channels
    : channels.filter((channel) => hasActivity(channel.id))

  return (
    <View
      className={
        // Projects read as a bounded container — dashed border, folder
        // disclosure — matching the web sidebar treatment.
        isProject
          ? "rounded-lor-md border border-dashed border-separator px-one pb-one pt-one"
          : undefined
      }
    >
      <Pressable
        accessibilityLabel={`${title}, ${channels.length} ${channels.length === 1 ? "channel" : "channels"}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="min-h-8 flex-row items-center gap-one px-two active:opacity-60"
        onPress={() => {
          void Haptics.selectionAsync()
          onToggle(id)
        }}
      >
        {isProject ? (
          <HugeiconsIcon
            color={muted}
            icon={expanded ? Folder02Icon : Folder01Icon}
            size={14}
            strokeWidth={2}
          />
        ) : (
          <View className={expanded ? "rotate-0" : "-rotate-90"}>
            <HugeiconsIcon
              color={muted}
              icon={ChevronDownIcon}
              size={12}
              strokeWidth={2.2}
            />
          </View>
        )}
        <SectionLabel>{title}</SectionLabel>
      </Pressable>

      {visibleChannels.map(renderRow)}
    </View>
  )
}

export function ChannelList({
  data,
  isLoading,
  onLongPress,
  onPress,
  projectCategoryIds,
}: {
  data?: { uncategorized: Channel[]; categories: ChannelCategory[] }
  isLoading: boolean
  onLongPress?: (channel: Channel) => void
  onPress: (channel: Channel) => void
  projectCategoryIds?: Set<string>
}) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set()
  )
  const { getUnreadCount, getMentionCount } = useUnread()

  if (isLoading && !data) return <ChannelListSkeleton />
  if (!data) return null

  const totalChannels =
    data.uncategorized.length +
    data.categories.reduce(
      (total, category) => total + category.channels.length,
      0
    )

  if (totalChannels === 0) {
    return <EmptyChannelList />
  }

  const toggleSection = (id: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hasActivity = (channelId: string) =>
    getUnreadCount(channelId) > 0 || getMentionCount(channelId) > 0

  const renderRow = (channel: Channel) => (
    <ChannelRow
      channel={channel}
      key={channel.id}
      mentionCount={getMentionCount(channel.id)}
      onLongPress={onLongPress}
      onPress={onPress}
      unread={getUnreadCount(channel.id) > 0}
    />
  )

  return (
    <View className="gap-four pb-seven">
      {data.uncategorized.length > 0 ? (
        <View>{data.uncategorized.map(renderRow)}</View>
      ) : null}
      {data.categories.map((category) => (
        <ChannelSection
          channels={category.channels}
          collapsed={collapsedSections.has(category.id)}
          hasActivity={hasActivity}
          id={category.id}
          isProject={projectCategoryIds?.has(category.id) ?? false}
          key={category.id}
          onToggle={toggleSection}
          renderRow={renderRow}
          title={category.name ?? "Channels"}
        />
      ))}
    </View>
  )
}

function EmptyChannelList() {
  const muted = useThemeColor("muted")
  return (
    <View className="items-start gap-three px-two py-eight">
      <View className="size-11 items-center justify-center rounded-lor-sm bg-surface-secondary">
        <HugeiconsIcon
          color={muted}
          icon={HashtagIcon}
          size={21}
          strokeWidth={1.7}
        />
      </View>
      <View className="gap-one">
        <Text className="text-base font-bold text-foreground">
          No channels yet
        </Text>
        <Text className="max-w-[310px] text-sm leading-5 text-muted">
          Create the first channel on web and it will appear here.
        </Text>
      </View>
    </View>
  )
}

function ChannelListSkeleton() {
  return (
    <View className="gap-five pb-seven">
      {[0, 1].map((section) => (
        <View className="gap-one" key={section}>
          <View className="min-h-8 flex-row items-center gap-two px-two">
            <Skeleton className="size-3 rounded-sm" />
            <Skeleton className="h-2.5 w-24 rounded-full" />
          </View>
          {[0, 1, 2, 3].map((row) => (
            <View
              className="min-h-[42px] flex-row items-center gap-two px-two"
              key={row}
            >
              <Skeleton className="size-5 rounded-md" />
              <Skeleton
                className={`${row % 2 ? "w-[38%]" : "w-[52%]"} h-3 rounded-full`}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}
