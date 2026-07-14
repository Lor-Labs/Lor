import { router } from "expo-router"
import { View } from "react-native"
import { StatePanel } from "@/components/ui/primitives"
import { Screen } from "@/components/ui/screen"

export default function FutureAreaScreen() {
  return (
    <Screen className="bg-lor-bg dark:bg-lor-bg-dark">
      <View className="flex-1">
        <StatePanel
          action={{
            label: "Open UI playground",
            onPress: () => router.push("/playground"),
          }}
          className="flex-1"
          detail="Preview the components, interaction states, and shared Lor theme before they move into product screens."
          title="HeroUI Native playground"
        />
      </View>
    </Screen>
  )
}
