import { router, useLocalSearchParams } from "expo-router"
import { Spinner } from "heroui-native/spinner"
import { View } from "react-native"
import { ThreadView } from "@/components/thread-view"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { useAgentSession } from "@/hooks/use-agent-session"

export default function SessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  const { data, error } = useAgentSession(sessionId ?? "")
  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace("/")
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      {data ? (
        <ThreadView
          channelId={data.session.channelId}
          session={{
            title: data.session.title,
            pending: data.pending === true,
          }}
          threadRootId={data.session.threadRootId}
        />
      ) : error ? (
        <StatePanel
          action={{ label: "Go back", onPress: goBack }}
          className="flex-1"
          detail="It may have been deleted, or it didn't start."
          status="danger"
          title="Session unavailable"
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading session" />
        </View>
      )}
    </Screen>
  )
}
