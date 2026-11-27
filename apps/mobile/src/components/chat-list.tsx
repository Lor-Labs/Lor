import Archive02Icon from "@hugeicons/core-free-icons/Archive02Icon"
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import DiscordIcon from "@hugeicons/core-free-icons/DiscordIcon"
import FilterHorizontalIcon from "@hugeicons/core-free-icons/FilterHorizontalIcon"
import NotificationOff01Icon from "@hugeicons/core-free-icons/NotificationOff01Icon"
import PinIcon from "@hugeicons/core-free-icons/PinIcon"
import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon"
import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon"
import ViewOffSlashIcon from "@hugeicons/core-free-icons/ViewOffSlashIcon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { LOR_USER_ID } from "@repo/db/constants"
import type {
  AgentNeed,
  ChannelActivity,
  SidebarSession,
} from "@repo/realtime-types"
import { router } from "expo-router"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { memo, useMemo, useRef } from "react"
import { Text, View, type ViewStyle } from "react-native"
import ReanimatedSwipeable, {
  type SwipeableMethods,
  SwipeDirection,
} from "react-native-gesture-handler/ReanimatedSwipeable"
import Animated, {
  type CSSStyle,
  interpolate,
  LayoutAnimationConfig,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
} from "react-native-reanimated"
import { AgentCreature } from "@/components/agent-creature"
import {
  ChannelSessionRows,
  SessionStateIndicator,
} from "@/components/channel-sessions"
import { ChatAvatar } from "@/components/chat-avatar"
import { useMutePrompt } from "@/components/mute-sheet"
import { triggerHaptic, triggerToggleHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import { PressableScale } from "@/components/ui/pressable-scale"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { LorMark } from "@/components/voice/lor-window"
import { useUnread } from "@/context/unread-context"
import { useWorkspaceSessionUpdates } from "@/hooks/use-agent-session"
import {
  agentCreature,
  useAgentsById,
  type WorkspaceAgent,
} from "@/hooks/use-agents"
import { type ChannelMute, useChannelMutes } from "@/hooks/use-channel-mutes"
import {
  type Chat,
  type ChatFilter,
  chatActivityAt,
  chatTime,
} from "@/hooks/use-chats"
import { useOpenedRow } from "@/hooks/use-opened-row"
import { useWorkspaceActivity } from "@/hooks/use-workspace-activity"
import { authClient } from "@/lib/auth-client"
import {
  CSS_EASE_OUT,
  LIST_REFLOW,
  POP_ENTER,
  POP_EXIT,
  ROW_ENTER,
  ROW_EXIT,
  STATE_MS,
  SWAP_ENTER,
  SWAP_EXIT,
} from "@/lib/motion"

// The home tab's chats (reference/agents-and-chats.md, decisions 33, 35 and
// 36): pinned first, then the rest by last message, each with its code
// sessions under it. As web's sidebar chat list, with the phone's gestures:
// swipe right pins, swipe left hides or mutes, and a long press opens the
// chat's actions.

const SESSIONS_ROW = "sessions"

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

export type ChatListProps = {
  chats: Chat[] | undefined
  isLoading: boolean
  workspaceSlug: string
  workspaceId: string
  filter: ChatFilter
  onOpenFilter: () => void
  onOpenChat: (chat: Chat) => void
  onLongPressChat: (chat: Chat) => void
  onOpenNeed: (chat: Chat, need: AgentNeed) => void
  onPin: (chat: Chat) => void
  onHide: (chat: Chat) => void
  // Opens every session you follow, across chats.
  onOpenSessions: () => void
}

export function ChatList({
  chats,
  isLoading,
  workspaceSlug,
  workspaceId,
  filter,
  onOpenFilter,
  onOpenChat,
  onLongPressChat,
  onOpenNeed,
  onPin,
  onHide,
  onOpenSessions,
}: ChatListProps) {
  const { data: auth } = authClient.useSession()
  const me = auth?.user.id
  const agentsById = useAgentsById(workspaceSlug)
  const { data: activity, isError: activityFailed } =
    useWorkspaceActivity(workspaceId)
  useWorkspaceSessionUpdates(workspaceId)
  const [openedId, setOpenedId] = useOpenedRow()
  const { getMute } = useChannelMutes()
  const { promptMute, muteSheet } = useMutePrompt()
  // One row open at a time, as in Mail: starting a swipe closes the last.
  const openRow = useRef<SwipeableMethods | null>(null)
  const activityByChat = useMemo(
    () => new Map((activity ?? []).map((row) => [row.channelId, row])),
    [activity]
  )

  if (isLoading && !chats) {
    return (
      <Animated.View exiting={SWAP_EXIT}>
        <ChatListSkeleton />
      </Animated.View>
    )
  }
  if (!chats) return null

  const pinned = chats.filter((chat) => chat.pinnedAt && !chat.archivedAt)
  const recent = chats.filter((chat) => !(chat.pinnedAt && !chat.archivedAt))
  const allSessions = (activity ?? []).flatMap((row) => row.sessions)
  const filtering = filter.archived || filter.places

  const row = (chat: Chat) => (
    <Animated.View
      entering={ROW_ENTER}
      exiting={ROW_EXIT}
      key={chat.id}
      layout={LIST_REFLOW}
    >
      <ChatRow
        activity={activityByChat.get(chat.id)}
        agentsById={agentsById}
        chat={chat}
        me={me}
        getMute={getMute}
        onLongPress={onLongPressChat}
        onOpen={(opened) => {
          setOpenedId(opened.id)
          onOpenChat(opened)
        }}
        onOpenNeed={onOpenNeed}
        onHide={onHide}
        onPin={onPin}
        onPromptMute={promptMute}
        onSwipeStart={(methods) => {
          if (openRow.current && openRow.current !== methods) {
            openRow.current.close()
          }
          openRow.current = methods
        }}
        selected={openedId === chat.id}
      />
      <ChatSessions
        activity={activityByChat.get(chat.id)}
        archived={Boolean(chat.archivedAt)}
        chatId={chat.id}
        onOpenSession={setOpenedId}
        openedId={openedId}
      />
    </Animated.View>
  )

  const filterButton = (
    <PressableScale
      accessibilityHint="Choose whether archived chats and Discord channels show"
      accessibilityLabel={filtering ? "Filter chats, on" : "Filter chats"}
      accessibilityRole="button"
      className={`size-8 items-center justify-center rounded-full ${
        filtering ? "bg-surface-secondary" : ""
      }`}
      hitSlop={8}
      onPress={() => {
        triggerHaptic("selection")
        onOpenFilter()
      }}
      scale={0.9}
    >
      <FilterGlyph on={filtering} />
    </PressableScale>
  )

  return (
    <Animated.View entering={SWAP_ENTER}>
      <LayoutAnimationConfig skipEntering>
        <View className="pb-seven">
          {allSessions.length > 0 || activityFailed ? (
            <SessionsSummaryRow
              onPress={() => {
                setOpenedId(SESSIONS_ROW)
                onOpenSessions()
              }}
              selected={openedId === SESSIONS_ROW}
              sessions={allSessions}
            />
          ) : null}
          {pinned.length > 0 ? (
            <SectionLabel action={filterButton} title="Pinned" />
          ) : null}
          {pinned.map(row)}
          {recent.length > 0 ? (
            <SectionLabel
              action={pinned.length === 0 ? filterButton : undefined}
              title="Recent"
            />
          ) : null}
          {recent.map(row)}
          {chats.length === 0 ? (
            <>
              <SectionLabel action={filterButton} title="" />
              <EmptyChatList />
            </>
          ) : null}
        </View>
      </LayoutAnimationConfig>
      {muteSheet}
    </Animated.View>
  )
}

function FilterGlyph({ on }: { on: boolean }) {
  const [foreground, muted] = useThemeColor(["foreground", "muted"])
  return (
    <HugeiconsIcon
      color={on ? foreground : muted}
      icon={FilterHorizontalIcon}
      size={17}
      strokeWidth={2}
    />
  )
}

function SectionLabel({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <Animated.View
      className="min-h-9 flex-row items-center justify-between pl-three pr-one pt-two"
      layout={LIST_REFLOW}
    >
      <Text
        accessibilityRole="header"
        className="text-[13px] font-semibold text-muted"
      >
        {title}
      </Text>
      {action}
    </Animated.View>
  )
}

const UNREAD_MARK: CSSStyle<ViewStyle> = {
  transitionProperty: ["opacity", "transform"],
  transitionDuration: STATE_MS,
  transitionTimingFunction: CSS_EASE_OUT,
}

// How far a row slides before the action under it commits or holds open.
const ACTION_WIDTH = 76

type ChatRowProps = {
  getMute: (channelId: string) => ChannelMute | null
  onPromptMute: (options: {
    channelId: string
    channelLabel: string
    mute: ChannelMute | null
  }) => void
  chat: Chat
  activity: ChannelActivity | undefined
  agentsById: Map<string, WorkspaceAgent>
  me: string | undefined
  selected: boolean
  onOpen: (chat: Chat) => void
  onLongPress: (chat: Chat) => void
  onOpenNeed: (chat: Chat, need: AgentNeed) => void
  onPin: (chat: Chat) => void
  onHide: (chat: Chat) => void
  onSwipeStart: (methods: SwipeableMethods) => void
}

const ChatRow = memo(function ChatRow({
  getMute,
  onPromptMute,
  chat,
  activity,
  agentsById,
  me,
  selected,
  onOpen,
  onLongPress,
  onOpenNeed,
  onPin,
  onHide,
  onSwipeStart,
}: ChatRowProps) {
  const [muted, accent, warning] = useThemeColor(["muted", "accent", "warning"])
  const reduced = useReducedMotion()
  const swipeable = useRef<SwipeableMethods>(null)
  const { getUnreadCount, getMentionCount } = useUnread()

  // Greyed while the list shows archived chats: nothing in it is unread,
  // pinned or running. A Discord channel is read in Discord, so it has no
  // unread, pin, hide or mute of its own here.
  const archived = Boolean(chat.archivedAt)
  const place = chat.place
  const quiet = archived || Boolean(place)
  const mute = quiet ? null : getMute(chat.id)
  const unread = !quiet && getUnreadCount(chat.id) > 0
  const mentionCount = quiet ? 0 : getMentionCount(chat.id)
  const emphasized = unread || mentionCount > 0
  const running = archived ? 0 : (activity?.runningSessions ?? 0)
  // An approval waiting on this person keeps a mark on the row until it is
  // decided, read or not.
  const approval = archived
    ? undefined
    : activity?.agentNeeds.find((need) => need.kind === "approval")
  const working = !archived && Boolean(activity?.agentWorking)

  const agents = chat.agentIds.flatMap((id) => agentsById.get(id) ?? [])
  const others = chat.people.filter((person) => person.id !== me)
  // Nobody else and no agent: the chat wears your own face.
  const people = others.length + agents.length > 0 ? others : chat.people
  const total =
    agents.length +
    Math.max(chat.peopleCount - (chat.joined ? 1 : 0), people.length)
  const name = chat.name ?? "Chat"
  const last = chat.lastMessage
  const lastAgent = last
    ? (agentsById.get(last.authorId) ??
      (last.authorId === LOR_USER_ID ? agents[0] : undefined))
    : undefined
  const mine = last?.authorId === me
  // Alone with one agent there is nobody else to name.
  const direct = chat.agentIds.length === 1 && chat.peopleCount === 1
  const preview = last
    ? `${mine ? "You: " : !lastAgent && !direct ? `${last.authorName.split(" ")[0]}: ` : ""}${last.preview}`
    : "No messages yet"

  const label = [
    name,
    chat.private ? "private" : null,
    archived ? "archived" : null,
    place ? "in Discord" : null,
    mute ? "muted" : null,
    mentionCount > 0
      ? `${mentionCount} ${mentionCount === 1 ? "mention" : "mentions"}`
      : unread
        ? "unread"
        : null,
    running > 0
      ? `${running} ${running === 1 ? "session" : "sessions"} running`
      : null,
    approval ? "waiting on your approval" : null,
    last ? `${preview}, ${chatTime(last.createdAt)}` : null,
  ]
    .filter(Boolean)
    .join(", ")

  const pressMute = () => {
    swipeable.current?.close()
    triggerHaptic("soft")
    onPromptMute({ channelId: chat.id, channelLabel: name, mute })
  }

  const content = (
    <PressableRow
      accessibilityActions={[
        { name: "activate" },
        { name: "longpress", label: "Chat actions" },
        ...(quiet
          ? []
          : [
              { name: "pin", label: chat.pinnedAt ? "Unpin" : "Pin" },
              { name: "hide", label: "Hide" },
            ]),
      ]}
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-[68px] flex-row items-center gap-three bg-background px-three py-two"
      delayLongPress={380}
      highlightClassName="bg-surface-secondary"
      onAccessibilityAction={(event) => {
        const action = event.nativeEvent.actionName
        if (action === "activate") onOpen(chat)
        else if (action === "longpress") onLongPress(chat)
        else if (action === "pin") onPin(chat)
        else if (action === "hide") onHide(chat)
      }}
      onLongPress={() => {
        triggerHaptic("medium")
        onLongPress(chat)
      }}
      onPress={() => onOpen(chat)}
      selected={selected}
    >
      <Animated.View
        className="absolute bottom-0 left-0 top-0 justify-center"
        pointerEvents="none"
        style={[
          UNREAD_MARK,
          emphasized
            ? { opacity: 1, transform: [{ scaleY: 1 }] }
            : { opacity: 0, transform: [{ scaleY: reduced ? 1 : 0.4 }] },
        ]}
      >
        <View className="h-4 w-[3px] rounded-r-full bg-accent" />
      </Animated.View>
      <View className={archived ? "opacity-50" : undefined}>
        <ChatAvatar
          agents={agents.map((agent) => ({
            id: agent.id,
            creature: agentCreature(agent),
          }))}
          people={people}
          total={total}
        />
      </View>
      <View
        className={`min-w-0 flex-1 gap-[2px] ${archived ? "opacity-60" : ""}`}
      >
        <View className="flex-row items-center gap-one">
          <Text
            className={`shrink text-[16px] leading-[21px] tracking-[-0.2px] text-foreground ${
              emphasized ? "font-bold" : "font-semibold"
            }`}
            numberOfLines={1}
          >
            {name}
          </Text>
          {chat.private ? <Mark icon={SquareLock02Icon} /> : null}
          {mute ? <Mark icon={NotificationOff01Icon} /> : null}
          {place ? <Mark icon={DiscordIcon} /> : null}
          {archived ? <Mark icon={Archive02Icon} /> : null}
          {chat.pinnedAt && !archived ? <Mark icon={PinIcon} /> : null}
          <View className="flex-1" />
          <Text
            className={`text-[12px] ${emphasized ? "text-accent" : "text-muted"}`}
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {chatTime(chatActivityAt(chat))}
          </Text>
        </View>
        <View className="min-h-5 flex-row items-center gap-two">
          {working && agents[0] ? (
            <AgentCreature
              creature={agentCreature(lastAgent ?? agents[0])}
              size={16}
              state="working"
            />
          ) : last && lastAgent && !direct ? (
            <AgentCreature
              creature={agentCreature(lastAgent)}
              size={16}
              still
            />
          ) : null}
          <Text
            className={`min-w-0 flex-1 text-[14px] leading-[19px] ${
              emphasized ? "text-foreground" : "text-muted"
            }`}
            numberOfLines={1}
          >
            {preview}
          </Text>
          {running > 0 ? (
            <View className="flex-row items-center">
              <SessionStateIndicator state="running" />
              <Text
                className="text-xs"
                style={{ color: accent, fontVariant: ["tabular-nums"] }}
              >
                {running}
              </Text>
            </View>
          ) : null}
          {approval ? (
            <PressableScale
              accessibilityLabel={`Waiting on your approval in ${name}`}
              accessibilityRole="button"
              className="size-6 items-center justify-center"
              hitSlop={10}
              onPress={() => {
                triggerHaptic("light")
                onOpenNeed(chat, approval)
              }}
              scale={0.88}
            >
              <View className="size-[18px] items-center justify-center rounded-full bg-warning-soft">
                <Text
                  className="text-[11px] font-bold leading-[13px]"
                  style={{ color: warning }}
                >
                  !
                </Text>
              </View>
            </PressableScale>
          ) : null}
          {mentionCount > 0 ? (
            <Animated.View entering={POP_ENTER} exiting={POP_EXIT}>
              <MentionBadge count={mentionCount} />
            </Animated.View>
          ) : unread ? (
            <Animated.View entering={POP_ENTER} exiting={POP_EXIT}>
              <View className="size-[9px] rounded-full bg-accent" />
            </Animated.View>
          ) : null}
        </View>
      </View>
    </PressableRow>
  )

  if (quiet) return content

  return (
    <ReanimatedSwipeable
      friction={1.6}
      leftThreshold={ACTION_WIDTH * 0.6}
      onSwipeableOpenStartDrag={() => {
        if (swipeable.current) onSwipeStart(swipeable.current)
      }}
      onSwipeableWillOpen={(direction) => {
        // The leading swipe pins in one go, like marking a mail unread.
        if (direction === SwipeDirection.RIGHT) {
          triggerHaptic("medium")
          onPin(chat)
          swipeable.current?.close()
        } else {
          triggerHaptic("light")
        }
      }}
      overshootLeft={false}
      overshootRight={false}
      ref={swipeable}
      renderLeftActions={(progress) => (
        <SwipeAction
          color={accent}
          icon={chat.pinnedAt ? PinOffIcon : PinIcon}
          label={chat.pinnedAt ? "Unpin" : "Pin"}
          onPress={() => {
            triggerHaptic("medium")
            onPin(chat)
            swipeable.current?.close()
          }}
          progress={progress}
          side="left"
        />
      )}
      renderRightActions={(progress) => (
        <View className="flex-row">
          <SwipeAction
            color={muted}
            icon={NotificationOff01Icon}
            label={mute ? "Unmute" : "Mute"}
            onPress={pressMute}
            progress={progress}
            side="right"
          />
          <SwipeAction
            color="#3f3f46"
            icon={ViewOffSlashIcon}
            label="Hide"
            onPress={() => {
              triggerHaptic("medium")
              swipeable.current?.close()
              onHide(chat)
            }}
            progress={progress}
            side="right"
          />
        </View>
      )}
      rightThreshold={ACTION_WIDTH * 0.6}
    >
      {content}
    </ReanimatedSwipeable>
  )
})

function Mark({ icon }: { icon: IconSvgElement }) {
  const muted = useThemeColor("muted")
  return <HugeiconsIcon color={muted} icon={icon} size={13} strokeWidth={2} />
}

// An action under a swiped row: its icon grows in as the row slides away.
function SwipeAction({
  color,
  icon,
  label,
  onPress,
  progress,
  side,
}: {
  color: string
  icon: IconSvgElement
  label: string
  onPress: () => void
  progress: SharedValue<number>
  side: "left" | "right"
}) {
  const reveal = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.6, 1], [0, 0.6, 1], "clamp"),
    transform: [
      {
        scale: interpolate(progress.get(), [0, 1], [0.7, 1], "clamp"),
      },
    ],
  }))
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      className={`items-center justify-center ${side === "left" ? "pl-two" : ""}`}
      hitSlop={0}
      onPress={onPress}
      scale={0.94}
      style={{ width: ACTION_WIDTH, backgroundColor: color }}
    >
      <Animated.View className="items-center gap-one" style={reveal}>
        <HugeiconsIcon color="#ffffff" icon={icon} size={20} strokeWidth={2} />
        <Text className="text-[12px] font-semibold text-white">{label}</Text>
      </Animated.View>
    </PressableScale>
  )
}

// A chat's code sessions under its row, lined up with its name.
function ChatSessions({
  chatId,
  activity,
  archived,
  openedId,
  onOpenSession,
}: {
  chatId: string
  activity: ChannelActivity | undefined
  archived: boolean
  openedId: string | null
  onOpenSession: (sessionId: string) => void
}) {
  const sessions = archived ? [] : (activity?.sessions ?? [])
  if (sessions.length === 0) return null
  return (
    <View className="pb-one pl-[26px]">
      <ChannelSessionRows
        channelId={chatId}
        collapsed={false}
        onOpenSession={onOpenSession}
        openedSessionId={openedId}
        sessions={sessions}
      />
    </View>
  )
}

// Every session you follow, in one place, with what needs you beside it.
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
  const needsYou = sessions.filter((s) => s.state === "needs_you").length
  const running = sessions.filter((s) => s.state === "running").length
  const unread = sessions.filter((s) => s.state === "unread").length
  const summary = [
    needsYou > 0 ? `${needsYou} need${needsYou === 1 ? "s" : ""} you` : null,
    running > 0 ? `${running} working` : null,
    unread > 0 ? `${unread} unread` : null,
  ].filter(Boolean)

  return (
    <Animated.View className="mb-one" layout={LIST_REFLOW}>
      <PressableRow
        accessibilityHint="Opens your sessions across every chat"
        accessibilityLabel={`Sessions${summary.length > 0 ? `, ${summary.join(", ")}` : ""}`}
        accessibilityRole="button"
        className="min-h-12 flex-row items-center gap-three rounded-lor-md px-three"
        onPress={onPress}
        selected={selected}
      >
        <View className="size-8 items-center justify-center rounded-full bg-surface-secondary">
          <LorMark size={17} />
        </View>
        <Text
          className="min-w-0 flex-1 text-[16px] font-semibold tracking-[-0.2px] text-foreground"
          numberOfLines={1}
        >
          Sessions
        </Text>
        {needsYou > 0 ? <SessionStateIndicator state="needs_you" /> : null}
        {running > 0 ? <SessionStateIndicator state="running" /> : null}
        {needsYou === 0 && running === 0 && unread > 0 ? (
          <SessionStateIndicator state="unread" />
        ) : null}
        <HugeiconsIcon
          color={muted}
          icon={ArrowRight01Icon}
          size={15}
          strokeWidth={2}
        />
      </PressableRow>
    </Animated.View>
  )
}

function EmptyChatList() {
  return (
    <View className="items-center gap-one px-six py-eight">
      <Text className="text-base font-semibold text-foreground">
        No chats yet
      </Text>
      <Text className="text-center text-sm leading-5 text-muted">
        Start one with the button at the top, with the people and agents you
        want in it.
      </Text>
    </View>
  )
}

// The same row heights as the real list, so nothing shifts when chats load.
export function ChatListSkeleton() {
  return (
    <View className="pb-seven pt-two">
      <View className="min-h-9 justify-center px-three">
        <Skeleton className="h-2.5 w-14 rounded-full" />
      </View>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <View
          className="min-h-[68px] flex-row items-center gap-three px-three py-two"
          key={row}
        >
          <Skeleton className="size-12 rounded-full" />
          <View className="flex-1 gap-two">
            <Skeleton
              className={`${row % 2 ? "w-[38%]" : "w-[52%]"} h-3 rounded-full`}
            />
            <Skeleton
              className={`${row % 3 ? "w-[70%]" : "w-[58%]"} h-2.5 rounded-full`}
            />
          </View>
        </View>
      ))}
    </View>
  )
}

// What the list adds besides your chats, each a switch.
export function ChatFilterSheet({
  isOpen,
  onOpenChange,
  filter,
  onChange,
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  filter: ChatFilter
  onChange: (kind: keyof ChatFilter, on: boolean) => void
}) {
  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content>
          <View className="flex-row items-center px-one pb-two">
            <BottomSheet.Title className="flex-1">Also show</BottomSheet.Title>
            <BottomSheet.Close />
          </View>
          <View className="gap-two pb-six">
            <FilterRow
              detail="Greyed, among the rest. Nobody can post in them."
              icon={Archive02Icon}
              label="Archived chats"
              on={filter.archived}
              onChange={(on) => onChange("archived", on)}
            />
            <FilterRow
              detail="The Discord channels agents are in."
              icon={DiscordIcon}
              label="Discord channels"
              on={filter.places}
              onChange={(on) => onChange("places", on)}
            />
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function FilterRow({
  icon,
  label,
  detail,
  on,
  onChange,
}: {
  icon: IconSvgElement
  label: string
  detail: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  const foreground = useThemeColor("foreground")
  return (
    <PressableRow
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      className="min-h-14 flex-row items-center gap-three rounded-lor-md bg-surface-secondary px-three py-three"
      highlightClassName="bg-surface-tertiary rounded-lor-md"
      onPress={() => {
        triggerToggleHaptic(!on)
        onChange(!on)
      }}
    >
      <HugeiconsIcon color={foreground} icon={icon} size={19} strokeWidth={2} />
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-[15px] font-semibold text-foreground">
          {label}
        </Text>
        <Text className="text-xs leading-4 text-muted">{detail}</Text>
      </View>
      <Switch isSelected={on} onSelectedChange={onChange} />
    </PressableRow>
  )
}

// Opens a chat at the message that waits on the person.
export function openNeed(chat: Chat, need: AgentNeed) {
  router.push(
    (need.threadRootId
      ? {
          pathname: "/channel/[channelId]/thread/[threadRootId]",
          params: {
            channelId: chat.id,
            threadRootId: need.threadRootId,
            focusMessageId: need.messageId,
          },
        }
      : {
          pathname: "/channel/[channelId]",
          params: { channelId: chat.id, focusMessageId: need.messageId },
        }) as never
  )
}
