import * as SplashScreen from "expo-splash-screen"
import { useEffect, useState } from "react"
import { Text } from "react-native"
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
    <Animated.View
      className="absolute inset-0 z-[1000] items-center justify-center bg-lor-accent"
      exiting={FadeOut.duration(180)}
    >
      <Animated.View
        className="h-16 w-16 items-center justify-center rounded-[20px] bg-lor-bg"
        entering={ZoomIn.duration(280)}
      >
        <Text className="text-[30px] font-bold text-lor-accent">L</Text>
      </Animated.View>
    </Animated.View>
  )
}
