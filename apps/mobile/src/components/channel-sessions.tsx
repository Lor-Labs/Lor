import RepeatIcon from "@hugeicons/core-free-icons/RepeatIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import type {
  ChannelActivity,
  SidebarSession,
  SidebarSessionState,
} from "@repo/realtime-types"
import { useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import * as SecureStore from "expo-secure-store"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native"
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated"
import { confirmArchiveSession } from "@/components/session-sheet"
import { TypewriterText } from "@/components/typewriter-text"
import { triggerHaptic } from "@/components/ui/haptics"
import { useWorkspace } from "@/context/workspace-context"
import {
  agentSessionQueryOptions,
  useUpdateAgentSession,
} from "@/hooks/use-agent-session"

// Each channel lists at most this many of your sessions; a "N more" row
// expands the rest in place. Mirrors web's channel-sessions.tsx.
const SESSION_CAP = 3

const rowIn = FadeIn.duration(160)
const rowOut = FadeOut.duration(120)
const rowLayout = LinearTransition.duration(180)

const STATE_LABELS = {
  needs_you: "Needs you",
  running: "Lor is working",
  unread: "Unread",
} as const

const COLLAPSED_KEY = "lor.collapsed-session-channels"

function readCollapsedIds(): Set<string> {
  try {
    return new Set(JSON.parse(SecureStore.getItem(COLLAPSED_KEY) ?? "[]"))
  } catch {
    return new Set()
  }
}

function storeCollapsedIds(ids: Set<string>) {
  try {
    SecureStore.setItem(COLLAPSED_KEY, JSON.stringify([...ids]))
  } catch {
    // Still applies until the app restarts; persistence is best-effort.
  }
}

// Channels whose session rows are hidden, remembered per device. Starting a
// session in a collapsed channel expands it.
export function useSessionCollapse(activity: ChannelActivity[] | undefined) {
  const [collapsed, setCollapsed] = useState(readCollapsedIds)
  const knownIds = useRef<Map<string, Set<string>> | null>(null)
  useEffect(() => {
    if (!activity) return
    const previous = knownIds.current
    knownIds.current = new Map(
      activity.map((channel) => [
        channel.channelId,
        new Set(channel.sessions.map((session) => session.id)),
      ])
    )
    if (!previous) return
    const grown = activity
      .filter((channel) =>
        channel.sessions.some(
          (session) => !previous.get(channel.channelId)?.has(session.id)
        )
      )
      .map((channel) => channel.channelId)
    setCollapsed((current) => {
      if (!grown.some((channelId) => current.has(channelId))) return current
      const next = new Set(current)
      for (const channelId of grown) next.delete(channelId)
      storeCollapsedIds(next)
      return next
    })
  }, [activity])

  const toggle = (channelId: string) => {
    const next = new Set(collapsed)
    if (next.has(channelId)) next.delete(channelId)
    else next.add(channelId)
    storeCollapsedIds(next)
    setCollapsed(next)
  }
  return { collapsed, toggle }
}

// Strongest state among some sessions, for a collapsed channel or the "N
// more" row: alert, then spinner, then dot.
export function strongestSessionState(
  sessions: SidebarSession[]
): SidebarSessionState | undefined {
  return (["needs_you", "running", "unread"] as const).find((state) =>
    sessions.some((session) => session.state === state)
  )
}

// A session's state: alert (needs you), spinner (running), dot (unread).
// Idle shows nothing.
export function SessionStateIndicator({
  state,
}: {
  state: SidebarSessionState
}) {
  const accent = useThemeColor("accent")
  if (state === "idle") return null
  if (state === "running") {
    return (
      <ActivityIndicator
        accessibilityLabel={STATE_LABELS.running}
        color={accent}
        size="small"
        style={{ transform: [{ scale: 0.6 }] }}
      />
    )
  }
  if (state === "unread") {
    return (
      <View
        accessibilityLabel={STATE_LABELS.unread}
        className="mx-[5px] size-1.5 rounded-full bg-accent"
      />
    )
  }
  return (
    <View
      accessibilityLabel={STATE_LABELS.needs_you}
      className="size-4 items-center justify-center rounded-full bg-warning-soft"
    >
      <Text className="text-[10px] font-bold leading-[12px] text-warning-soft-foreground">
        !
      </Text>
    </View>
  )
}

// Your sessions in a channel, under its row: newest activity first, whatever
// the state.
export function ChannelSessionRows({
  channelId,
  sessions,
  collapsed,
  hint,
  onOpenSession,
}: {
  channelId: string
  sessions: SidebarSession[] | undefined
  collapsed: boolean
  // Under the rows: the sessions_intro hint, on the first channel with any.
  hint?: ReactNode
  onOpenSession?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const ordered = useMemo(
    () =>
      [...(sessions ?? [])].sort((a, b) =>
        b.lastActivityAt.localeCompare(a.lastActivityAt)
      ),
    [sessions]
  )
  if (ordered.length === 0) return null
  // Rendered while collapsed too, so the rows animate out.
  const visible = collapsed
    ? []
    : expanded
      ? ordered
      : ordered.slice(0, SESSION_CAP)
  const hidden = expanded ? [] : ordered.slice(SESSION_CAP)
  const rollup = strongestSessionState(hidden)

  return (
    // Lines up with the channel name: row padding + icon box + gap.
    <View className={`pl-[36px] ${collapsed ? "" : "mb-one"}`}>
      {visible.map((session) => (
        <Animated.View
          entering={rowIn}
          exiting={rowOut}
          key={session.id}
          layout={rowLayout}
        >
          <SessionRow
            channelId={channelId}
            onOpen={onOpenSession}
            session={session}
          />
        </Animated.View>
      ))}
      {!collapsed && ordered.length > SESSION_CAP ? (
        <Animated.View entering={rowIn} exiting={rowOut} layout={rowLayout}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            className="min-h-9 flex-row items-center gap-two rounded-lor-sm px-two active:bg-surface-secondary"
            onPress={() => setExpanded((current) => !current)}
          >
            <Text
              className="min-w-0 flex-1 text-[14px] text-muted"
              numberOfLines={1}
            >
              {expanded ? "Show less" : `${hidden.length} more`}
            </Text>
            {rollup ? <SessionStateIndicator state={rollup} /> : null}
          </Pressable>
        </Animated.View>
      ) : null}
      {collapsed ? null : hint}
    </View>
  )
}

// Long-press archives it, like the archive button on web's row hover.
function SessionRow({
  channelId,
  onOpen,
  session,
}: {
  channelId: string
  onOpen?: () => void
  session: SidebarSession
}) {
  const muted = useThemeColor("muted")
  const queryClient = useQueryClient()
  const { workspace } = useWorkspace()
  const updateSession = useUpdateAgentSession()
  const emphasized = session.state === "unread" || session.state === "needs_you"
  const stateLabel =
    session.state === "idle" ? "" : `, ${STATE_LABELS[session.state]}`
  const archive = () => {
    if (!workspace) return
    confirmArchiveSession(session.state === "running", () =>
      updateSession.mutate({
        workspaceId: workspace.id,
        channelId,
        sessionId: session.id,
        archived: true,
      })
    )
  }

  return (
    <Pressable
      accessibilityActions={[{ label: "Archive", name: "archive" }]}
      accessibilityLabel={`Open session ${session.title}${stateLabel}`}
      accessibilityRole="button"
      className="min-h-9 flex-row items-center gap-two rounded-lor-sm px-two active:bg-surface-secondary"
      delayLongPress={350}
      onAccessibilityAction={archive}
      onLongPress={() => {
        triggerHaptic("medium")
        Alert.alert(session.title, undefined, [
          { style: "cancel", text: "Cancel" },
          { style: "destructive", text: "Archive", onPress: archive },
        ])
      }}
      // Warm the session's page during the press, so it opens filled.
      onPressIn={() =>
        void queryClient.prefetchQuery(agentSessionQueryOptions(session.id))
      }
      onPress={() => {
        onOpen?.()
        router.push({
          pathname: "/session/[sessionId]",
          params: { sessionId: session.id },
        })
      }}
    >
      {session.loop ? (
        <HugeiconsIcon
          color={muted}
          icon={RepeatIcon}
          size={14}
          strokeWidth={2}
        />
      ) : null}
      <Text
        className={`min-w-0 flex-1 text-[14px] ${
          emphasized ? "font-medium text-foreground" : "text-muted"
        }`}
        numberOfLines={1}
      >
        <TypewriterText animate={!session.titleEdited} text={session.title} />
      </Text>
      <SessionStateIndicator state={session.state} />
    </Pressable>
  )
}
