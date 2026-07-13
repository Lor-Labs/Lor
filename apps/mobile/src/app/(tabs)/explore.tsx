import { router } from "expo-router"
import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { StatePanel } from "@/components/ui/primitives"

export default function FutureAreaScreen() {
  return (
    <SafeAreaView
      className="flex-1 bg-lor-bg dark:bg-lor-bg-dark"
      style={{ flex: 1 }}
    >
      <View className="flex-1">
        <StatePanel
          action={{ label: "Back to channels", onPress: () => router.back() }}
          detail="Search, notifications, and workspace settings will be added here without changing the channel navigation model."
          title="A workspace area, not a dead end"
        />
      </View>
    </SafeAreaView>
  )
}
