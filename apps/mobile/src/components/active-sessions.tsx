import type { SidebarSession, SidebarSessionState } from "@repo/realtime-types"
import { useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { useMemo } from "react"
import { Pressable, Text, View } from "react-native"
import { SessionStateIndicator } from "@/components/channel-sessions"
import { SectionLabel } from "@/components/ui/section-label"
import { agentSessionQueryOptions } from "@/hooks/use-agent-session"

// Cross-channel "Sessions" list below the channels: your subscribed sessions
// that need you, are running or have unread replies. Mirrors web's
// active-sessions.tsx.

const STATE_ORDER: Record<SidebarSessionState, number> = {
  needs_you: 0,
  running: 1,
  unread: 2,
  idle: 3,
}

const STATE_TEXT: Record<Exclude<SidebarSessionState, "idle">, string> = {
  needs_you: "Needs you",
  running: "Lor is working",
  unread: "New reply",
}

type ActiveSession = { session: SidebarSession; channelId: string }

export function ActiveSessions({
  channelNames,
  sessionsByChannel,
}: {
  channelNames: Map<string, string | null>
  sessionsByChannel: Map<string, SidebarSession[]>
}) {
  const active = useMemo(
    () =>
      [...sessionsByChannel.entries()]
        .flatMap(([channelId, sessions]) =>
          sessions
            .filter((session) => session.state !== "idle")
            .map((session) => ({ session, channelId }))
        )
        .sort(
          (a, b) =>
            STATE_ORDER[a.session.state] - STATE_ORDER[b.session.state] ||
            b.session.lastActivityAt.localeCompare(a.session.lastActivityAt)
        ),
    [sessionsByChannel]
  )
  const needsYou = active.filter(
    ({ session }) => session.state === "needs_you"
  ).length

  return (
    <View className="gap-one">
      <View className="min-h-8 flex-row items-center gap-two px-two">
        <SectionLabel>Sessions</SectionLabel>
        {needsYou > 0 ? (
          <View className="rounded-full bg-warning-soft px-1.5">
            <Text className="text-[11px] font-medium text-warning-soft-foreground">
              {needsYou} needs you
            </Text>
          </View>
        ) : null}
      </View>
      {active.length === 0 ? (
        <Text className="px-two text-[13px] leading-5 text-muted">
          Tasks you hand to Lor show up here while they run. Type @Lor in a
          channel to start one.
        </Text>
      ) : (
        active.map((item) => (
          <ActiveSessionRow
            channelName={channelNames.get(item.channelId) ?? null}
            item={item}
            key={item.session.id}
          />
        ))
      )}
    </View>
  )
}

function ActiveSessionRow({
  channelName,
  item: { session },
}: {
  channelName: string | null
  item: ActiveSession
}) {
  const queryClient = useQueryClient()
  const detail = session.state === "idle" ? null : STATE_TEXT[session.state]
  const subtitle = [detail, channelName && `#${channelName}`]
    .filter(Boolean)
    .join(" · ")

  return (
    <Pressable
      accessibilityLabel={`Open session ${session.title}, ${subtitle}`}
      accessibilityRole="button"
      className="min-h-[48px] flex-row items-center gap-two rounded-lor-sm px-two active:bg-surface-secondary"
      onPressIn={() =>
        void queryClient.prefetchQuery(agentSessionQueryOptions(session.id))
      }
      onPress={() =>
        router.push({
          pathname: "/session/[sessionId]",
          params: { sessionId: session.id },
        })
      }
    >
      <View className="size-7 items-center justify-center">
        <SessionStateIndicator state={session.state} />
      </View>
      <View className="min-w-0 flex-1">
        <Text
          className="text-[15px] font-medium leading-5 text-foreground"
          numberOfLines={1}
        >
          {session.title}
        </Text>
        <Text
          className={`text-[12px] leading-4 ${
            session.state === "needs_you"
              ? "text-warning-soft-foreground"
              : "text-muted"
          }`}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  )
}
