import { router } from "expo-router"
import { StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { StatePanel } from "@/components/ui/primitives"
import { useTheme } from "@/hooks/use-theme"

export default function FutureAreaScreen() {
  const theme = useTheme()
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
    >
      <View style={styles.content}>
        <StatePanel
          action={{ label: "Back to channels", onPress: () => router.back() }}
          detail="Search, notifications, and workspace settings will be added here without changing the channel navigation model."
          title="A workspace area, not a dead end"
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
})
