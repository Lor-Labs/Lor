import { isChannelFeatureEnabled } from "@repo/utils/features"
import { Redirect, Slot, useLocalSearchParams } from "expo-router"
import { Spinner } from "heroui-native/spinner"
import { View } from "react-native"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelDetail } from "@/hooks/use-channel-detail"

// Guard every channel destination, including saved call-chat and summary links.
export default function ChannelLayout() {
  const { workspace, isLoading } = useWorkspace()
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  const {
    channel,
    isLoading: loadingChannel,
    error,
    reload,
  } = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })

  if (isLoading || loadingChannel) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner />
      </View>
    )
  }
  if (!workspace) return <Redirect href="/" />
  if (error) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <StatePanel
          title="Channel unavailable"
          detail={error}
          action={{ label: "Try again", onPress: () => void reload() }}
        />
      </Screen>
    )
  }
  if (!channel || !isChannelFeatureEnabled(channel))
    return <Redirect href="/" />
  return <Slot />
}
