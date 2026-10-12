import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon"
import RepeatIcon from "@hugeicons/core-free-icons/RepeatIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { timeAgo } from "@repo/utils/date"
import { router, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useState } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native"
import { confirmArchiveSession } from "@/components/session-actions-sheet"
import { Avatar } from "@/components/ui/avatar"
import { triggerHaptic } from "@/components/ui/haptics"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { Tabs } from "@/components/ui/tabs"
import { useWorkspace } from "@/context/workspace-context"
import { useUpdateAgentSession } from "@/hooks/use-agent-session"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import {
  type ChannelSession,
  useChannelSessions,
} from "@/hooks/use-channel-sessions"

// Everyone's sessions in the channel, so teammates can browse and join each
// other's work. Opening one never subscribes you. Mirrors web's Sessions
// list panel.
export default function ChannelSessionsScreen() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  const { workspace } = useWorkspace()
  const foreground = useThemeColor("foreground")
  const [filter, setFilter] = useState<"active" | "archived">("active")
  const archived = filter === "archived"
  const channelState = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })
  const sessions = useChannelSessions(channelId ?? "", archived)
  const channelName = channelState.channel?.name ?? "channel"

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else if (channelId) {
      router.replace({
        pathname: "/channel/[channelId]",
        params: { channelId },
      })
    } else router.replace("/")
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton accessibilityLabel="Back" onPress={goBack} variant="ghost">
          <SymbolView
            name={{
              ios: "chevron.left",
              android: "arrow_back",
              web: "arrow_back",
            }}
            size={21}
            tintColor={foreground}
          />
        </IconButton>
        <View className="min-w-0 flex-1 gap-px">
          <Text className="text-[17px] font-bold tracking-[-0.2px] text-foreground">
            Sessions
          </Text>
          <Text className="text-xs font-medium leading-4 text-muted">
            #{channelName}
          </Text>
        </View>
        <IconButton
          accessibilityLabel="New session"
          onPress={() =>
            router.push({
              pathname: "/session/new",
              params: { channelId: channelId ?? "" },
            })
          }
          variant="ghost"
        >
          <HugeiconsIcon color={foreground} icon={PencilEdit02Icon} size={20} />
        </IconButton>
      </View>
      <View className="border-b border-separator px-four py-two">
        <Tabs
          onValueChange={(value) =>
            setFilter(value === "archived" ? "archived" : "active")
          }
          value={filter}
        >
          <Tabs.List>
            <Tabs.Indicator />
            <Tabs.Trigger value="active">
              <Tabs.Label>Active</Tabs.Label>
            </Tabs.Trigger>
            <Tabs.Trigger value="archived">
              <Tabs.Label>Archived</Tabs.Label>
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs>
      </View>
      {sessions.isPending ? (
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading sessions" />
        </View>
      ) : sessions.isError ? (
        <StatePanel
          action={{
            label: "Try again",
            onPress: () => void sessions.refetch(),
          }}
          className="flex-1"
          detail="Check your connection and try again."
          status="danger"
          title="Sessions are unavailable"
        />
      ) : sessions.data.length === 0 ? (
        <StatePanel
          className="flex-1"
          detail={
            archived
              ? "Archived sessions show here."
              : `Mention @Lor in #${channelName} to start one.`
          }
          title={archived ? "No archived sessions" : "No sessions yet"}
        />
      ) : (
        <FlatList
          className="flex-1"
          contentContainerStyle={{ padding: 8, paddingBottom: 32 }}
          data={sessions.data}
          keyExtractor={(session) => session.id}
          onRefresh={() => void sessions.refetch()}
          refreshing={sessions.isRefetching}
          renderItem={({ item }) => (
            <SessionListRow
              channelId={channelId ?? ""}
              session={item}
              workspaceId={workspace?.id ?? null}
            />
          )}
        />
      )}
    </Screen>
  )
}

// Long-press archives or unarchives it (web's hover button).
function SessionListRow({
  session,
  channelId,
  workspaceId,
}: {
  session: ChannelSession
  channelId: string
  workspaceId: string | null
}) {
  const [muted, accent] = useThemeColor(["muted", "accent"])
  const updateSession = useUpdateAgentSession()
  const archived = session.archivedAt !== null
  const byline = session.loop ? "Loop" : (session.creator?.name ?? "Lor")
  const when = timeAgo(
    archived ? (session.archivedAt ?? "") : session.lastActivityAt
  )
  const setArchived = (next: boolean) => {
    if (!workspaceId) return
    updateSession.mutate({
      workspaceId,
      channelId,
      sessionId: session.id,
      archived: next,
    })
  }

  return (
    <Pressable
      accessibilityActions={[
        { label: archived ? "Unarchive" : "Archive", name: "archive" },
      ]}
      accessibilityLabel={`${session.title}, ${byline}, ${when}${session.running ? ", Lor is working" : ""}`}
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-three rounded-lor-sm px-two py-two active:bg-surface-secondary"
      delayLongPress={350}
      onAccessibilityAction={() =>
        archived
          ? setArchived(false)
          : confirmArchiveSession(session.running, () => setArchived(true))
      }
      onLongPress={() => {
        triggerHaptic("medium")
        Alert.alert(session.title, undefined, [
          { style: "cancel", text: "Cancel" },
          archived
            ? { text: "Unarchive", onPress: () => setArchived(false) }
            : {
                style: "destructive",
                text: "Archive",
                onPress: () =>
                  confirmArchiveSession(session.running, () =>
                    setArchived(true)
                  ),
              },
        ])
      }}
      onPress={() =>
        router.push({
          pathname: "/session/[sessionId]",
          params: { sessionId: session.id },
        })
      }
    >
      {session.creator ? (
        <Avatar
          avatarColor={session.creator.avatarColor}
          className="size-7"
          fallback={session.creator.name.charAt(0).toUpperCase()}
          image={session.creator.image}
          name={session.creator.name}
          size="xs"
        />
      ) : (
        <View className="size-7 items-center justify-center">
          <HugeiconsIcon color={muted} icon={RepeatIcon} size={16} />
        </View>
      )}
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-[15px] text-foreground" numberOfLines={1}>
          {session.title}
        </Text>
        <Text className="text-xs text-muted" numberOfLines={1}>
          {byline} · {when}
        </Text>
      </View>
      {session.running ? (
        <ActivityIndicator
          accessibilityLabel="Lor is working"
          color={accent}
          size="small"
          style={{ transform: [{ scale: 0.6 }] }}
        />
      ) : null}
    </Pressable>
  )
}
