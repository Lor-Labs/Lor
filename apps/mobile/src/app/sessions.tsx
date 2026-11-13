import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import type { SidebarSession } from "@repo/realtime-types"
import { timeAgo } from "@repo/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useMemo } from "react"
import { ScrollView, Text, View } from "react-native"
import Animated, { LayoutAnimationConfig } from "react-native-reanimated"
import {
  SessionStateIndicator,
  sessionKindIcon,
  sessionRowLabel,
  useSessionRowActions,
} from "@/components/channel-sessions"
import { LineCounts } from "@/components/code-drawer-parts"
import { ConnectionPill } from "@/components/connection-pill"
import { TypewriterText } from "@/components/typewriter-text"
import { IconButton } from "@/components/ui/icon-button"
import { PressableRow } from "@/components/ui/pressable-row"
import { Screen } from "@/components/ui/screen"
import { ScreenHeader } from "@/components/ui/screen-header"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { useOpenedRow } from "@/hooks/use-opened-row"
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh"
import {
  useWorkspaceActivity,
  workspaceActivityKey,
} from "@/hooks/use-workspace-activity"
import { LIST_REFLOW, ROW_ENTER, ROW_EXIT } from "@/lib/motion"
import { workspaceChannelsQueryOptions } from "@/lib/workspace-channels"

type Row = { session: SidebarSession; channelId: string; channelName: string }

const GROUPS = [
  { state: "needs_you", title: "Needs you" },
  { state: "running", title: "Working" },
  { state: "unread", title: "Unread" },
  { state: "idle", title: "Recent" },
] as const

// Every session you follow, across channels, by what it wants from you:
// the same rows the Home tab lists under each channel, without scanning
// the channels for them. Sessions you don't follow are on each channel's
// own Sessions page.
export default function SessionsScreen() {
  const { workspace } = useWorkspace()
  const foreground = useThemeColor("foreground")
  const queryClient = useQueryClient()
  const {
    data: activity,
    isError: activityFailed,
    refetch: refetchActivity,
  } = useWorkspaceActivity(workspace?.id)
  const { data: channels } = useQuery(
    workspaceChannelsQueryOptions(workspace?.slug ?? "")
  )
  const [openedId, setOpenedId] = useOpenedRow()
  const groups = useMemo(() => {
    const names = new Map(
      [
        ...(channels?.uncategorized ?? []),
        ...(channels?.categories.flatMap((category) => category.channels) ??
          []),
      ].map((channel) => [channel.id, channel.name ?? "channel"])
    )
    const rows: Row[] = (activity ?? []).flatMap((channel) =>
      channel.sessions.map((session) => ({
        session,
        channelId: channel.channelId,
        channelName: names.get(channel.channelId) ?? "channel",
      }))
    )
    return GROUPS.map((group) => ({
      ...group,
      rows: rows
        .filter((row) => row.session.state === group.state)
        .sort((a, b) =>
          b.session.lastActivityAt.localeCompare(a.session.lastActivityAt)
        ),
    })).filter((group) => group.rows.length > 0)
  }, [activity, channels])

  const refreshControl = usePullToRefresh(async () => {
    if (!workspace) return
    await queryClient.invalidateQueries({
      queryKey: workspaceActivityKey(workspace.id),
    })
  })

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <ScreenHeader
        right={
          <IconButton
            accessibilityLabel="New session"
            onPress={() => router.push("/session/new")}
            variant="ghost"
          >
            <HugeiconsIcon
              color={foreground}
              icon={PencilEdit02Icon}
              size={20}
            />
          </IconButton>
        }
        subtitle={workspace?.name}
        title="Sessions"
      />
      <View className="flex-1">
        {activity === undefined && activityFailed ? (
          <StatePanel
            action={{
              label: "Try again",
              onPress: () => void refetchActivity(),
            }}
            className="flex-1"
            detail="Check your connection and try again."
            status="danger"
            title="Sessions are unavailable"
          />
        ) : activity === undefined ? (
          <View className="flex-1 items-center justify-center">
            <Spinner accessibilityLabel="Loading sessions" />
          </View>
        ) : groups.length === 0 ? (
          <StatePanel
            className="flex-1"
            detail="Mention @Lor in a channel to start one. The sessions you follow show here."
            title="No sessions yet"
          />
        ) : (
          <ScrollView
            className="flex-1"
            contentContainerClassName="gap-three px-two pb-seven pt-two"
            refreshControl={refreshControl}
            showsVerticalScrollIndicator={false}
          >
            {/* A session changing state moves between groups: it fades out
                of one and into the other while the rest slide. */}
            <LayoutAnimationConfig skipEntering>
              {groups.map((group) => (
                <Animated.View
                  entering={ROW_ENTER}
                  exiting={ROW_EXIT}
                  key={group.state}
                  layout={LIST_REFLOW}
                >
                  <View className="min-h-9 flex-row items-center gap-[6px] px-two">
                    <Text className="text-[13px] font-semibold leading-[18px] text-muted">
                      {group.title}
                    </Text>
                    <Text
                      className="text-[13px] leading-[18px] text-muted"
                      style={{ fontVariant: ["tabular-nums"] }}
                    >
                      {group.rows.length}
                    </Text>
                  </View>
                  {group.rows.map((row) => (
                    <Animated.View
                      entering={ROW_ENTER}
                      exiting={ROW_EXIT}
                      key={row.session.id}
                      layout={LIST_REFLOW}
                    >
                      <SessionListRow
                        {...row}
                        onOpen={() => setOpenedId(row.session.id)}
                        selected={openedId === row.session.id}
                      />
                    </Animated.View>
                  ))}
                </Animated.View>
              ))}
            </LayoutAnimationConfig>
          </ScrollView>
        )}
        <ConnectionPill />
      </View>
    </Screen>
  )
}

function SessionListRow({
  session,
  channelId,
  channelName,
  onOpen,
  selected,
}: Row & { onOpen: () => void; selected: boolean }) {
  const muted = useThemeColor("muted")
  const actions = useSessionRowActions({ channelId, session, onOpen })
  const emphasized = session.state === "unread" || session.state === "needs_you"
  return (
    <PressableRow
      accessibilityActions={[{ label: "Archive", name: "archive" }]}
      accessibilityLabel={`${sessionRowLabel(session)}, in ${channelName}`}
      accessibilityRole="button"
      className="min-h-[56px] flex-row items-center gap-three px-two py-two"
      delayLongPress={350}
      onAccessibilityAction={actions.archive}
      onLongPress={actions.promptArchive}
      onPress={actions.open}
      onPressIn={actions.prefetch}
      selected={selected}
    >
      <View className="min-w-0 flex-1 gap-[2px]">
        <Text
          className={`text-[16px] leading-[22px] tracking-[-0.1px] text-foreground ${
            emphasized ? "font-semibold" : "font-normal"
          }`}
          numberOfLines={1}
        >
          <TypewriterText animate={!session.titleEdited} text={session.title} />
        </Text>
        <View className="flex-row items-center gap-[6px]">
          <HugeiconsIcon
            color={muted}
            icon={sessionKindIcon(session)}
            size={13}
            strokeWidth={2}
          />
          <Text className="shrink text-[13px] text-muted" numberOfLines={1}>
            #{channelName} · {timeAgo(session.lastActivityAt)}
          </Text>
        </View>
      </View>
      {session.uncommitted ? <LineCounts {...session.uncommitted} /> : null}
      <SessionStateIndicator state={session.state} />
    </PressableRow>
  )
}
