import Archive02Icon from "@hugeicons/core-free-icons/Archive02Icon"
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon"
import Folder02Icon from "@hugeicons/core-free-icons/Folder02Icon"
import HashtagIcon from "@hugeicons/core-free-icons/HashtagIcon"
import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon"
import VolumeHighIcon from "@hugeicons/core-free-icons/VolumeHighIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import type { SidebarSession, SidebarSessionState } from "@repo/realtime-types"
import {
  type OwnVoicePresence,
  withOwnVoicePresence,
} from "@repo/realtime-types/voice-presence"
import { router } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Text, View, type ViewStyle } from "react-native"
import Animated, {
  type CSSStyle,
  LayoutAnimationConfig,
  useReducedMotion,
} from "react-native-reanimated"
import {
  ChannelSessionRows,
  SessionStateIndicator,
  strongestSessionState,
  useSessionCollapse,
} from "@/components/channel-sessions"
import { HintCard } from "@/components/hint-card"
import { Avatar } from "@/components/ui/avatar"
import { DisclosureChevron } from "@/components/ui/disclosure-chevron"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import { PressableScale } from "@/components/ui/pressable-scale"
import { PrivateHashIcon } from "@/components/ui/private-hash-icon"
import { Skeleton } from "@/components/ui/skeleton"
import { LorMark } from "@/components/voice/lor-window"
import { useUnread } from "@/context/unread-context"
import { useVoiceCall } from "@/context/voice-call-context"
import { useWorkspace } from "@/context/workspace-context"
import { useWorkspaceSessionUpdates } from "@/hooks/use-agent-session"
import { useHint } from "@/hooks/use-hints"
import { useOpenedRow } from "@/hooks/use-opened-row"
import { useVoicePresence } from "@/hooks/use-voice-presence"
import type { VoiceParticipant } from "@/hooks/use-voice-sessions"
import { useWorkspaceActivity } from "@/hooks/use-workspace-activity"
import type { Channel, ChannelCategory } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import {
  CSS_EASE_OUT,
  LIST_REFLOW,
  POP_ENTER,
  POP_EXIT,
  ROW_ENTER,
  ROW_EXIT,
  SCROLL_PRESS_DELAY_MS,
  STATE_MS,
  SWAP_ENTER,
  SWAP_EXIT,
} from "@/lib/motion"

// The Sessions row's id as an opened row; channel and session ids are UUIDs.
const SESSIONS_ROW = "sessions"

// The unread mark grows in from its middle and fades, so a channel going
// unread while you look at the list is noticed without a jump.
const UNREAD_MARK: CSSStyle<ViewStyle> = {
  transitionProperty: ["opacity", "transform"],
  transitionDuration: STATE_MS,
  transitionTimingFunction: CSS_EASE_OUT,
}

export function MentionBadge({ count }: { count: number }) {
  return (
    <View className="h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5">
      <Text
        className="text-[11px] font-bold leading-[13px] text-danger-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
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
  selected = false,
  sessionToggle,
  unread,
}: {
  channel: Channel
  mentionCount: number
  onLongPress?: (channel: Channel) => void
  onPress: (channel: Channel) => void
  // The channel is the one open on top of the list (useOpenedRow).
  selected?: boolean
  // Set when the channel lists your sessions. `rollup`: the strongest state
  // among them while collapsed.
  sessionToggle?: {
    collapsed: boolean
    onToggle: () => void
    rollup: SidebarSessionState | undefined
  }
  unread: boolean
}) {
  const [foreground, muted] = useThemeColor(["foreground", "muted"])
  const reduced = useReducedMotion()
  const isVoice = channel.type === "voice"
  // Standalone private channels wear a lock instead of their type glyph;
  // project channels don't — the project boundary communicates the audience.
  const isPrivate = channel.audience === "members" && channel.parentId === null
  const emphasized = unread || mentionCount > 0

  return (
    <View className="flex-row items-center">
      <PressableRow
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
        className="min-h-11 min-w-0 flex-1 flex-row items-center gap-two px-two"
        delayLongPress={350}
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
                triggerHaptic("medium")
                onLongPress(channel)
              }
            : undefined
        }
        onPress={() => onPress(channel)}
        selected={selected}
      >
        <Animated.View
          className="absolute bottom-0 left-0 top-0 justify-center"
          pointerEvents="none"
          style={[
            UNREAD_MARK,
            // With reduced motion it only fades.
            emphasized
              ? { opacity: 1, transform: [{ scaleY: 1 }] }
              : { opacity: 0, transform: [{ scaleY: reduced ? 1 : 0.4 }] },
          ]}
        >
          <View className="h-3 w-[3px] rounded-full bg-foreground" />
        </Animated.View>
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
          className={`min-w-0 flex-1 text-[16px] leading-[22px] tracking-[-0.1px] ${
            emphasized
              ? "font-semibold text-foreground"
              : "font-normal text-muted"
          }`}
          numberOfLines={1}
        >
          {channel.name ?? "untitled"}
        </Text>
        {mentionCount > 0 ? (
          <Animated.View entering={POP_ENTER} exiting={POP_EXIT}>
            <MentionBadge count={mentionCount} />
          </Animated.View>
        ) : null}
        {sessionToggle?.collapsed && sessionToggle.rollup ? (
          <SessionStateIndicator state={sessionToggle.rollup} />
        ) : null}
        {/* Keeps the row's trailing content clear of the toggle beside it. */}
        {sessionToggle ? <View className="w-7" /> : null}
      </PressableRow>
      {/* Beside the row, not inside it: a pressable inside a pressable
          fights it for the touch, and both would show a highlight. */}
      {sessionToggle ? (
        <PressableScale
          accessibilityLabel={
            sessionToggle.collapsed ? "Show sessions" : "Hide sessions"
          }
          accessibilityRole="button"
          accessibilityState={{ expanded: !sessionToggle.collapsed }}
          className="absolute right-0 size-9 items-center justify-center"
          hitSlop={6}
          onPress={() => {
            triggerHaptic("selection")
            sessionToggle.onToggle()
          }}
          scale={0.9}
          unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
        >
          <DisclosureChevron color={muted} open={!sessionToggle.collapsed} />
        </PressableScale>
      ) : null}
    </View>
  )
}

// People connected to a voice channel's call, listed under it like web.
// Pressing them joins the call straight away.
function VoiceParticipantRows({
  participants,
  channelName,
  onJoin,
}: {
  participants: VoiceParticipant[] | undefined
  channelName: string
  onJoin: () => void
}) {
  if (!participants?.length) return null
  return (
    <Animated.View entering={ROW_ENTER} exiting={ROW_EXIT} layout={LIST_REFLOW}>
      {/* Lines up with the channel name: row padding + icon box + gap. */}
      <PressableRow
        accessibilityLabel={`Join the call in ${channelName}`}
        accessibilityRole="button"
        className="mb-one pl-[44px]"
        onPress={onJoin}
      >
        {participants.map((participant) => (
          <View
            className="min-h-8 flex-row items-center gap-two"
            key={participant.userId}
          >
            <Avatar
              avatarColor={participant.avatarColor}
              className="size-5"
              image={participant.image}
              name={participant.name}
              size="xs"
            />
            <Text
              className="min-w-0 flex-1 text-[14px] text-muted"
              numberOfLines={1}
            >
              {participant.name}
            </Text>
          </View>
        ))}
      </PressableRow>
    </Animated.View>
  )
}

// A fold's heading (a category, a project, Archived): the name as it was
// typed, then the chevron that says which way it is folded.
function SectionHeader({
  accessibilityLabel,
  expanded,
  leading,
  onToggle,
  title,
}: {
  accessibilityLabel: string
  expanded: boolean
  // A project's folder (or its archiving spinner) before the name.
  leading?: ReactNode
  onToggle: () => void
  title: string
}) {
  const muted = useThemeColor("muted")
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      className="min-h-9 flex-row items-center gap-[6px] self-start px-two"
      feedback="dim"
      onPress={() => {
        triggerHaptic("selection")
        onToggle()
      }}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
    >
      {leading}
      <Text
        className="shrink text-[13px] font-semibold leading-[18px] text-muted"
        numberOfLines={1}
      >
        {title}
      </Text>
      <DisclosureChevron color={muted} open={expanded} size={11} />
    </PressableScale>
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

  const header = (
    <SectionHeader
      accessibilityLabel={`${title}, ${channels.length} ${channels.length === 1 ? "channel" : "channels"}`}
      expanded={expanded}
      leading={
        isProject ? (
          isArchiving ? (
            <ActivityIndicator color={muted} size="small" />
          ) : (
            <HugeiconsIcon
              color={muted}
              icon={expanded ? Folder02Icon : Folder01Icon}
              size={15}
              strokeWidth={2}
            />
          )
        ) : undefined
      }
      onToggle={() => onToggle(id)}
      title={title}
    />
  )

  // Projects read as a bounded container — dashed border, folder
  // disclosure — matching the web sidebar treatment.
  if (isProject) {
    return (
      <Animated.View
        className="mt-three rounded-lor-lg border border-dashed border-separator px-one pb-one pt-one"
        layout={LIST_REFLOW}
      >
        {header}
        {visibleChannels.map(renderRow)}
      </Animated.View>
    )
  }
  // No box around a plain category: its heading and rows sit in the list
  // beside every other row, so a fold only fades rows and slides the rest.
  return (
    <>
      <Animated.View className="mt-three" layout={LIST_REFLOW}>
        {header}
      </Animated.View>
      {visibleChannels.map(renderRow)}
    </>
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
    <Animated.View
      className="mt-three border-t border-separator pt-two"
      layout={LIST_REFLOW}
    >
      <SectionHeader
        accessibilityLabel={`Archived projects, ${categories.length} ${categories.length === 1 ? "project" : "projects"}`}
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
        title="Archived"
      />
      {expanded
        ? categories.map((category) => (
            <Animated.View
              className="opacity-70"
              entering={ROW_ENTER}
              exiting={ROW_EXIT}
              key={category.id}
              layout={LIST_REFLOW}
            >
              <View className="min-h-9 flex-row items-center gap-[6px] px-two">
                <HugeiconsIcon
                  color={muted}
                  icon={Archive02Icon}
                  size={15}
                  strokeWidth={2}
                />
                <Text
                  className="shrink text-[13px] font-semibold leading-[18px] text-muted"
                  numberOfLines={1}
                >
                  {category.name ?? "Project"}
                </Text>
              </View>
              {category.channels.map(renderRow)}
            </Animated.View>
          ))
        : null}
    </Animated.View>
  )
}

export function ChannelList({
  archivedCategoryIds,
  archivingCategoryIds,
  data,
  isLoading,
  onLongPress,
  onOpenSessions,
  onPress,
  projectCategoryIds,
}: {
  archivedCategoryIds?: Set<string>
  archivingCategoryIds?: Set<string>
  data?: { uncategorized: Channel[]; categories: ChannelCategory[] }
  isLoading: boolean
  onLongPress?: (channel: Channel) => void
  // Opens every session you follow, across channels.
  onOpenSessions?: () => void
  onPress: (channel: Channel) => void
  projectCategoryIds?: Set<string>
}) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set()
  )
  const { getUnreadCount, getMentionCount } = useUnread()
  const { workspace, avatarColor } = useWorkspace()
  const { call, joining, join, ownVoiceChannel } = useVoiceCall()
  const { data: auth } = authClient.useSession()
  const activity = useWorkspaceActivity(workspace?.id)
  useWorkspaceSessionUpdates(workspace?.id)
  const sessionCollapse = useSessionCollapse(activity)
  const sessionsHint = useHint("sessions_intro")
  const [openedId, setOpenedId] = useOpenedRow()
  const sessionsSettled = useSessionsSettled(
    activity !== undefined,
    Boolean(data)
  )
  const sessionsByChannel = useMemo(
    () =>
      new Map(
        (activity ?? []).map((channel) => [channel.channelId, channel.sessions])
      ),
    [activity]
  )
  const presence = useVoicePresence(workspace?.slug, workspace?.id)
  const user = auth?.user
  const inCall = useMemo(() => {
    const own: OwnVoicePresence | null =
      ownVoiceChannel && user && ownVoiceChannel.workspaceId === workspace?.id
        ? ownVoiceChannel.left
          ? {
              left: true,
              channelId: ownVoiceChannel.channelId,
              userId: user.id,
            }
          : {
              left: false,
              channelId: ownVoiceChannel.channelId,
              participant: {
                userId: user.id,
                name: user.name,
                image: user.image ?? null,
                avatarColor,
                connected: true,
              },
            }
        : null
    return new Map(
      withOwnVoicePresence(presence ?? [], own).map((channel) => [
        channel.channelId,
        channel.participants,
      ])
    )
  }, [presence, ownVoiceChannel, user, workspace?.id, avatarColor])

  // Opens the voice channel and joins its call (unless already in it).
  const joinCall = (channel: Channel) => {
    router.push({
      pathname: "/channel/[channelId]",
      params: { channelId: channel.id },
    } as never)
    if (!workspace || joining || call?.channelId === channel.id) return
    void join({
      workspaceId: workspace.id,
      channelId: channel.id,
      channelName: channel.name ?? "Voice",
    })
  }

  if ((isLoading && !data) || (data && !sessionsSettled)) {
    return (
      <Animated.View exiting={SWAP_EXIT}>
        <ChannelListSkeleton />
      </Animated.View>
    )
  }
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
  // Taught under the first session rows a person sees, usually the ones
  // their first @Lor just started.
  const sessionsHintChannelId = sessionsHint.dismissed
    ? null
    : [
        ...data.uncategorized,
        ...activeCategories
          .filter((category) => !collapsedSections.has(category.id))
          .flatMap((category) => category.channels),
      ].find(
        (channel) =>
          channel.type !== "voice" &&
          !sessionCollapse.collapsed.has(channel.id) &&
          (sessionsByChannel.get(channel.id)?.length ?? 0) > 0
      )?.id

  const renderRow = (channel: Channel) => {
    const sessions = sessionsByChannel.get(channel.id) ?? []
    const collapsed = sessionCollapse.collapsed.has(channel.id)
    return (
      <Fragment key={channel.id}>
        <Animated.View
          entering={ROW_ENTER}
          exiting={ROW_EXIT}
          layout={LIST_REFLOW}
        >
          <ChannelRow
            channel={channel}
            mentionCount={getMentionCount(channel.id)}
            onLongPress={onLongPress}
            onPress={(opened) => {
              setOpenedId(opened.id)
              onPress(opened)
            }}
            selected={openedId === channel.id}
            sessionToggle={
              sessions.length > 0
                ? {
                    collapsed,
                    onToggle: () => sessionCollapse.toggle(channel.id),
                    rollup: collapsed
                      ? strongestSessionState(sessions)
                      : undefined,
                  }
                : undefined
            }
            unread={getUnreadCount(channel.id) > 0}
          />
        </Animated.View>
        {channel.type === "voice" ? (
          <VoiceParticipantRows
            channelName={channel.name ?? "voice"}
            onJoin={() => joinCall(channel)}
            participants={inCall.get(channel.id)}
          />
        ) : (
          <ChannelSessionRows
            channelId={channel.id}
            collapsed={collapsed}
            hint={
              channel.id === sessionsHintChannelId ? (
                <HintCard
                  className="ml-[44px] mr-two mt-one"
                  onDismiss={sessionsHint.dismiss}
                >
                  Lor works in sessions, listed under their channel. Anyone in
                  the channel can open one and join in.
                </HintCard>
              ) : undefined
            }
            onOpenSession={(sessionId) => {
              sessionsHint.dismiss()
              setOpenedId(sessionId)
            }}
            openedSessionId={openedId}
            sessions={sessions}
          />
        )}
      </Fragment>
    )
  }

  const allSessions = (activity ?? []).flatMap((channel) => channel.sessions)

  return (
    // The list fades in over the placeholder as one piece. The rows already
    // there don't each fade in; only rows that arrive or fold open later do.
    <Animated.View entering={SWAP_ENTER}>
      <LayoutAnimationConfig skipEntering>
        {/* One flat run of rows and headings: nothing that moves sits inside
            a box that also resizes, so a fold is only fades and slides. */}
        <View className="pb-seven">
          {onOpenSessions && allSessions.length > 0 ? (
            <SessionsSummaryRow
              onPress={() => {
                setOpenedId(SESSIONS_ROW)
                onOpenSessions()
              }}
              selected={openedId === SESSIONS_ROW}
              sessions={allSessions}
            />
          ) : null}
          {data.uncategorized.map(renderRow)}
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
      </LayoutAnimationConfig>
    </Animated.View>
  )
}

// The session rows come over the socket a moment after the channels. The
// list waits that moment so it arrives whole instead of showing and then
// making room for them; past it (a slow or dropped connection) the list
// shows without them and they join when they load.
const SESSIONS_WAIT_MS = 600

function useSessionsSettled(loaded: boolean, waiting: boolean) {
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    if (!waiting || loaded) return
    const timer = setTimeout(() => setGaveUp(true), SESSIONS_WAIT_MS)
    return () => clearTimeout(timer)
  }, [waiting, loaded])
  return loaded || gaveUp
}

// Every session you follow, in one place: the first row of the list, with
// what needs you now beside it so the list doesn't have to be scanned.
function SessionsSummaryRow({
  sessions,
  onPress,
  selected,
}: {
  sessions: SidebarSession[]
  onPress: () => void
  selected: boolean
}) {
  const muted = useThemeColor("muted")
  const needsYou = sessions.filter(
    (session) => session.state === "needs_you"
  ).length
  const running = sessions.filter(
    (session) => session.state === "running"
  ).length
  const unread = sessions.filter((session) => session.state === "unread").length
  const summary = [
    needsYou > 0 ? `${needsYou} need${needsYou === 1 ? "s" : ""} you` : null,
    running > 0 ? `${running} working` : null,
    unread > 0 ? `${unread} unread` : null,
  ].filter(Boolean)

  return (
    <Animated.View className="mb-two" layout={LIST_REFLOW}>
      <PressableRow
        accessibilityHint="Opens your sessions across every channel"
        accessibilityLabel={`Sessions${summary.length > 0 ? `, ${summary.join(", ")}` : ""}`}
        accessibilityRole="button"
        className="min-h-11 flex-row items-center gap-two px-two"
        onPress={onPress}
        selected={selected}
      >
        <View className="size-7 items-center justify-center">
          <LorMark size={19} />
        </View>
        <Text
          className="min-w-0 flex-1 text-[16px] font-medium leading-[22px] tracking-[-0.1px] text-foreground"
          numberOfLines={1}
        >
          Sessions
        </Text>
        {needsYou > 0 ? (
          <View className="h-5 flex-row items-center gap-one rounded-full bg-warning-soft px-two">
            <Text
              className="text-[11px] font-bold leading-[13px] text-warning-soft-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {needsYou}
            </Text>
          </View>
        ) : null}
        {running > 0 ? <SessionStateIndicator state="running" /> : null}
        {needsYou === 0 && running === 0 && unread > 0 ? (
          <SessionStateIndicator state="unread" />
        ) : null}
        {/* The same 20pt box as the marks under it, so they share a centre. */}
        <View className="size-5 items-center justify-center">
          <HugeiconsIcon
            color={muted}
            icon={ArrowRight01Icon}
            size={14}
            strokeWidth={2}
          />
        </View>
      </PressableRow>
    </Animated.View>
  )
}

function EmptyChannelList() {
  const muted = useThemeColor("muted")
  return (
    <View className="items-start gap-three px-two py-eight">
      <View className="size-11 items-center justify-center rounded-lor-md bg-surface-secondary">
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

// Same row heights and insets as the real list, so nothing shifts when the
// channels arrive.
export function ChannelListSkeleton() {
  return (
    <View className="gap-three pb-seven">
      {[4, 3].map((rows, section) => (
        <View key={rows}>
          {section > 0 ? (
            <View className="min-h-9 justify-center px-two">
              <Skeleton className="h-2.5 w-16 rounded-full" />
            </View>
          ) : null}
          {Array.from({ length: rows }, (_, row) => (
            <View
              className="min-h-11 flex-row items-center gap-two px-two"
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
              key={row}
            >
              <View className="size-7 items-center justify-center">
                <Skeleton className="size-[18px] rounded-md" />
              </View>
              <Skeleton
                className={`${row % 2 ? "w-[34%]" : "w-[48%]"} h-3 rounded-full`}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}
