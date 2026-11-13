import Infinity01Icon from "@hugeicons/core-free-icons/Infinity01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { router, useLocalSearchParams } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { FlatList, Text, View } from "react-native"
import { LoopStatusChip, openLoop } from "@/components/loop-card"
import { PressableRow } from "@/components/ui/pressable-row"
import { Screen } from "@/components/ui/screen"
import { ScreenHeader } from "@/components/ui/screen-header"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { sortLoops, useChannelLoops } from "@/hooks/use-loops"
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh"
import type { ChannelLoop } from "@/lib/api-types"

// A channel's loops (Lor's scheduled runs): what runs first, then paused,
// drafts and finished ones. Each opens its page. Mirrors web's Loops list
// panel.
export default function ChannelLoopsScreen() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  const { workspace } = useWorkspace()
  const channelState = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })
  const loops = useChannelLoops(channelId ?? "")
  const channelName = channelState.channel?.name ?? "channel"
  const sorted = sortLoops(loops.data ?? [])
  const refreshControl = usePullToRefresh(loops.refetch)

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <ScreenHeader
        onBack={() =>
          channelId
            ? router.replace({
                pathname: "/channel/[channelId]",
                params: { channelId },
              })
            : router.replace("/")
        }
        subtitle={`#${channelName}`}
        title="Loops"
      />
      {loops.isPending ? (
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading loops" />
        </View>
      ) : loops.isError ? (
        <StatePanel
          action={{ label: "Try again", onPress: () => void loops.refetch() }}
          className="flex-1"
          detail="Check your connection and try again."
          status="danger"
          title="Loops are unavailable"
        />
      ) : sorted.length === 0 ? (
        <StatePanel
          action={{
            label: loops.isRefetching ? "Refreshing…" : "Refresh",
            onPress: () => void loops.refetch(),
          }}
          className="flex-1"
          detail="Ask Lor to do something on a schedule to set one up."
          title="No loops in this channel yet"
        />
      ) : (
        <FlatList
          className="flex-1"
          contentContainerStyle={{ padding: 8, paddingBottom: 32 }}
          data={sorted}
          keyExtractor={(loop) => loop.id}
          refreshControl={refreshControl}
          renderItem={({ item }) => <LoopRow loop={item} />}
        />
      )}
    </Screen>
  )
}

function LoopRow({ loop }: { loop: ChannelLoop }) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const live = loop.status === "active" || loop.status === "draft"
  return (
    <PressableRow
      accessibilityHint="Opens the loop"
      accessibilityLabel={`${loop.name}, ${loop.status}, ${describeLoopSchedule(loop.schedule, loop.timezone)}`}
      accessibilityRole="button"
      className={`min-h-[56px] flex-row items-center gap-three px-two py-two ${
        loop.status === "completed" ? "opacity-60" : ""
      }`}
      onPress={() => openLoop(loop)}
    >
      <View className="size-7 items-center justify-center">
        <HugeiconsIcon
          color={live ? accent : muted}
          icon={Infinity01Icon}
          size={18}
          strokeWidth={2}
        />
      </View>
      <View className="min-w-0 flex-1 gap-[2px]">
        <Text
          className="text-[16px] leading-[22px] tracking-[-0.1px] text-foreground"
          numberOfLines={1}
        >
          {loop.name}
        </Text>
        <Text className="text-[13px] text-muted" numberOfLines={1}>
          {describeLoopSchedule(loop.schedule, loop.timezone)}
        </Text>
      </View>
      {loop.status === "active" ? null : (
        <LoopStatusChip status={loop.status} />
      )}
    </PressableRow>
  )
}
