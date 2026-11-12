import { Spinner } from "heroui-native/spinner"
import { useEffect, useState } from "react"
import { Text, View } from "react-native"
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated"
import { useSocketConnected } from "@/context/socket-context"
import { EASE_OUT } from "@/lib/motion"

// A dropped connection that comes back within this long never shows: most
// are a moment's blip, and so is the first connect after launch.
const SHOW_AFTER_MS = 2_000

const PILL_IN = FadeInUp.duration(220).easing(EASE_OUT)
const PILL_OUT = FadeOutUp.duration(160).easing(EASE_OUT)

// "Reconnecting…" over the top of a list while the realtime connection is
// down, for screens with no composer to say so (the Home tab): unread
// marks and session states may be stale until it returns. Floats over the
// list, so nothing shifts when it comes and goes.
export function ConnectionPill() {
  const connected = useSocketConnected()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (connected) {
      setShown(false)
      return
    }
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [connected])

  if (!shown) return null
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      className="absolute inset-x-0 top-two items-center"
      entering={PILL_IN}
      exiting={PILL_OUT}
      pointerEvents="none"
    >
      <View className="min-h-8 flex-row items-center gap-two rounded-full border border-border bg-overlay px-three shadow-sm">
        <Spinner color="default" size="sm" />
        <Text className="text-[13px] font-medium text-foreground">
          Reconnecting…
        </Text>
      </View>
    </Animated.View>
  )
}
