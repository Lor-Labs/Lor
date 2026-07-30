import * as SplashScreen from "expo-splash-screen"
import { useEffect, useState } from "react"
import { Image } from "react-native"
import Animated, { FadeOut, ZoomIn } from "react-native-reanimated"
import splashMark from "../../assets/images/splash-icon.png"

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
      className="absolute inset-0 z-[1000] items-center justify-center bg-black"
      exiting={FadeOut.duration(180)}
    >
      <Animated.View entering={ZoomIn.duration(280)}>
        <Image source={splashMark} style={{ width: 76, height: 46 }} />
      </Animated.View>
    </Animated.View>
  )
}
