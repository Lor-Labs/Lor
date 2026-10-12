import { useLocalSearchParams } from "expo-router"
import { ThreadView, type ThreadViewProps } from "@/components/thread-view"
import { Screen } from "@/components/ui/screen"

export default function ThreadScreen() {
  const params =
    useLocalSearchParams<Omit<ThreadViewProps, "embedded" | "session">>()
  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <ThreadView {...params} />
    </Screen>
  )
}
