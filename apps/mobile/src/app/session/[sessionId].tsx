import { router, useLocalSearchParams } from "expo-router"
import { Spinner } from "heroui-native/spinner"
import { View } from "react-native"
import { ThreadView } from "@/components/thread-view"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import {
  useAgentSession,
  useAgentSessionUpdates,
} from "@/hooks/use-agent-session"

export default function SessionScreen() {
  // `focusMessageId`: a forward, search result or pin lands on its message.
  const { sessionId, focusMessageId } = useLocalSearchParams<{
    sessionId: string
    focusMessageId?: string
  }>()
  const { data, error } = useAgentSession(sessionId ?? "")
  useAgentSessionUpdates(sessionId ?? "")
  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace("/")
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      {data ? (
        <ThreadView
          channelId={data.session.channelId}
          focusMessageId={focusMessageId}
          session={data.session}
          sessionPending={data.pending === true}
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
