import { router, useLocalSearchParams } from "expo-router"
import { Spinner } from "heroui-native/spinner"
import { View } from "react-native"
import { LoopDetail } from "@/components/loop-detail"
import { Screen } from "@/components/ui/screen"
import { ScreenHeader } from "@/components/ui/screen-header"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useLoop } from "@/hooks/use-loops"

// A Loop's page, whichever chat it reports in, or none
// (reference/agents-and-chats.md §9).
export default function LoopScreen() {
  const { loopId } = useLocalSearchParams<{ loopId: string }>()
  const { workspace } = useWorkspace()
  const { loop, isError, refetch } = useLoop(loopId ?? "")
  const { channel } = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: loop?.channelId ?? "",
  })
  // Back to wherever it was opened from; its chat (or home) for a deep link.
  const back = () => {
    if (router.canGoBack()) router.back()
    else if (loop?.channelId) {
      router.replace({
        pathname: "/channel/[channelId]",
        params: { channelId: loop.channelId },
      })
    } else router.replace("/")
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <ScreenHeader
        onBack={back}
        subtitle={loop?.channelId ? (channel?.name ?? undefined) : "No chat"}
        title={loop?.name ?? "Loop"}
      />
      {loop ? (
        <LoopDetail loop={loop} />
      ) : loop === undefined && !isError ? (
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading the loop" />
        </View>
      ) : isError ? (
        <StatePanel
          action={{ label: "Try again", onPress: refetch }}
          className="flex-1"
          detail="Check your connection and try again."
          status="danger"
          title="The loop is unavailable"
        />
      ) : (
        <StatePanel
          action={{ label: "Go back", onPress: back }}
          className="flex-1"
          detail="It may have been deleted."
          title="This loop is no longer available"
        />
      )}
    </Screen>
  )
}
