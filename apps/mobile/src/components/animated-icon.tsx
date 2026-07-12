import * as SplashScreen from "expo-splash-screen"
import { useEffect, useState } from "react"
import { StyleSheet, Text } from "react-native"
import Animated, { FadeOut, ZoomIn } from "react-native-reanimated"

export function AnimatedSplashOverlay() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    void SplashScreen.hideAsync()
    const timer = setTimeout(() => setVisible(false), 460)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <Animated.View exiting={FadeOut.duration(180)} style={styles.overlay}>
      <Animated.View entering={ZoomIn.duration(280)} style={styles.mark}>
        <Text style={styles.markText}>L</Text>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: "#6c4abb",
    justifyContent: "center",
    zIndex: 1000,
  },
  mark: {
    alignItems: "center",
    backgroundColor: "#fdfcf9",
    borderRadius: 20,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  markText: { color: "#6c4abb", fontSize: 30, fontWeight: "700" },
})
