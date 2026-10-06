import Archive02Icon from "@hugeicons/core-free-icons/Archive02Icon"
import ChevronDownIcon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon"
import Folder02Icon from "@hugeicons/core-free-icons/Folder02Icon"
import HashtagIcon from "@hugeicons/core-free-icons/HashtagIcon"
import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon"
import VolumeHighIcon from "@hugeicons/core-free-icons/VolumeHighIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import type { ChannelActivity } from "@repo/realtime-types"
import * as Haptics from "expo-haptics"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { PrivateHashIcon } from "@/components/ui/private-hash-icon"
import { SectionLabel } from "@/components/ui/section-label"
import { Skeleton } from "@/components/ui/skeleton"
import { useUnread } from "@/context/unread-context"
import { useWorkspace } from "@/context/workspace-context"
import { useWorkspaceActivity } from "@/hooks/use-workspace-activity"
import type { Channel, ChannelCategory } from "@/lib/api-types"

type LorState = NonNullable<ChannelActivity["lor"]>

const lorLabels: Record<LorState, string> = {
  working: "Lor is working",
  queued: "Lor is queued",
  needs_input: "Lor needs input",
  needs_approval: "Awaiting approval",
}

function LorChannelStatus({ state }: { state: LorState }) {
  const accent = useThemeColor("accent")
  if (state === "working") {
    return (
      <ActivityIndicator
        accessibilityLabel={lorLabels.working}
        color={accent}
        size="small"
        style={{ transform: [{ scale: 0.7 }] }}
      />
    )
  }
  if (state === "queued") {
    return (
      <View
        accessibilityLabel={lorLabels.queued}
        className="size-1.5 rounded-full bg-accent opacity-60"
      />
    )
  }
  return (
    <View
      accessibilityLabel={lorLabels[state]}
      className="size-4 items-center justify-center rounded-full bg-warning-soft"
    >
      <Text className="text-[10px] font-bold leading-[12px] text-warning-soft-foreground">
        !
      </Text>
    </View>
  )
}

export function MentionBadge({ count }: { count: number }) {
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
  lorState,
  mentionCount,
  onLongPress,
  onPress,
  unread,
}: {
  channel: Channel
  lorState?: LorState
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
      }${lorState ? `, ${lorLabels[lorState]}` : ""}`}
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
        {isPrivate && !isVoice ? (
          <PrivateHashIcon
            color={emphasized ? foreground : muted}
            size={19}
            strokeWidth={emphasized ? 2 : 1.8}
          />
        ) : (
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
        )}
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
      {lorState ? <LorChannelStatus state={lorState} /> : null}
    </Pressable>
  )
}

function ChannelSection({
  channels,
  collapsed,
  hasActivity,
  id,
  isArchiving = false,
  isProject = false,
  onToggle,
  renderRow,
  title,
}: {
  channels: Channel[]
  collapsed: boolean
  hasActivity: (channelId: string) => boolean
  id: string
  isArchiving?: boolean
  isProject?: boolean
  onToggle: (id: string) => void
  renderRow: (channel: Channel) => ReactNode
  title: string
}) {
  const muted = useThemeColor("muted")
  // Empty projects still show their header (a just-created project has no
  // channels yet); empty non-project categories stay hidden.
  if (channels.length === 0 && !isProject) return null

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
          isArchiving ? (
            <ActivityIndicator color={muted} size="small" />
          ) : (
            <HugeiconsIcon
              color={muted}
              icon={expanded ? Folder02Icon : Folder01Icon}
              size={14}
              strokeWidth={2}
            />
          )
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

// Archived projects: collapsed by default, muted, read-only — channels stay
// navigable (history is preserved). Mirrors the web sidebar's Archived
// section.
function ArchivedProjectsSection({
  categories,
  renderRow,
}: {
  categories: ChannelCategory[]
  renderRow: (channel: Channel) => ReactNode
}) {
  const muted = useThemeColor("muted")
  const [expanded, setExpanded] = useState(false)

  return (
    <View className="border-t border-separator pt-three">
      <Pressable
        accessibilityLabel={`Archived projects, ${categories.length} ${categories.length === 1 ? "project" : "projects"}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="min-h-8 flex-row items-center gap-one px-two active:opacity-60"
        onPress={() => {
          void Haptics.selectionAsync()
          setExpanded((current) => !current)
        }}
      >
        <View className={expanded ? "rotate-0" : "-rotate-90"}>
          <HugeiconsIcon
            color={muted}
            icon={ChevronDownIcon}
            size={12}
            strokeWidth={2.2}
          />
        </View>
        <SectionLabel>Archived</SectionLabel>
      </Pressable>
      {expanded
        ? categories.map((category) => (
            <View className="opacity-70" key={category.id}>
              <View className="min-h-8 flex-row items-center gap-one px-two">
                <HugeiconsIcon
                  color={muted}
                  icon={Archive02Icon}
                  size={14}
                  strokeWidth={2}
                />
                <SectionLabel>{category.name ?? "Project"}</SectionLabel>
              </View>
              {category.channels.map(renderRow)}
            </View>
          ))
        : null}
    </View>
  )
}

export function ChannelList({
  archivedCategoryIds,
  archivingCategoryIds,
  data,
  isLoading,
  onLongPress,
  onPress,
  projectCategoryIds,
}: {
  archivedCategoryIds?: Set<string>
  archivingCategoryIds?: Set<string>
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
  const { workspace } = useWorkspace()
  const activity = useWorkspaceActivity(workspace?.id)
  const lorStates = useMemo(() => {
    const map = new Map<string, LorState>()
    for (const channel of activity ?? []) {
      if (channel.lor) map.set(channel.channelId, channel.lor)
    }
    return map
  }, [activity])

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

  // Archived projects drop out of the live tree into a muted, collapsed
  // section; archiving projects stay in place with a spinner until the
  // worker finishes.
  const activeCategories = data.categories.filter(
    (category) => !archivedCategoryIds?.has(category.id)
  )
  const archivedCategories = data.categories.filter((category) =>
    archivedCategoryIds?.has(category.id)
  )

  const renderRow = (channel: Channel) => (
    <ChannelRow
      channel={channel}
      key={channel.id}
      lorState={lorStates.get(channel.id)}
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
      {activeCategories.map((category) => (
        <ChannelSection
          channels={category.channels}
          collapsed={collapsedSections.has(category.id)}
          hasActivity={hasActivity}
          id={category.id}
          isArchiving={archivingCategoryIds?.has(category.id) ?? false}
          isProject={projectCategoryIds?.has(category.id) ?? false}
          key={category.id}
          onToggle={toggleSection}
          renderRow={renderRow}
          title={category.name ?? "Channels"}
        />
      ))}
      {archivedCategories.length > 0 ? (
        <ArchivedProjectsSection
          categories={archivedCategories}
          renderRow={renderRow}
        />
      ) : null}
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
