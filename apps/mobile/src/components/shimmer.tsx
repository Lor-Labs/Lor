import type { ReactNode } from "react"
import { useEffect } from "react"
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated"

// Half a cycle; the animation reverses, so a full pulse is ~1.8s — close to the
// 2s sweep web's `.shimmer` utility runs.
const HALF_CYCLE_MS = 900
const DIM_OPACITY = 0.45

/**
 * Mobile stand-in for web's `.shimmer` text utility.
 *
 * Web sweeps a gradient highlight across the glyphs via `background-clip: text`,
 * which needs a gradient masked to text — not available here without
 * `expo-linear-gradient` + `masked-view` (both native, both a dev-client
 * rebuild). This pulses opacity instead: same read of "in progress", no new
 * native dependencies.
 *
 * Opacity is animated on a wrapping view rather than colour on `Animated.Text`
 * so children keep their NativeWind classes, which don't reliably apply to
 * Reanimated's components.
 */
export function Shimmer({
  active = true,
  children,
}: {
  active?: boolean
  children: ReactNode
}) {
  const reduceMotion = useReducedMotion()
  const phase = useSharedValue(1)

  useEffect(() => {
    // Honour the OS setting the same way web honours prefers-reduced-motion:
    // hold the text at full strength rather than pulsing it.
    if (!active || reduceMotion) {
      cancelAnimation(phase)
      phase.value = 1
      return
    }

    phase.value = withRepeat(
      withTiming(DIM_OPACITY, {
        duration: HALF_CYCLE_MS,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    )

    return () => {
      cancelAnimation(phase)
    }
  }, [active, reduceMotion, phase])

  const animatedStyle = useAnimatedStyle(() => ({ opacity: phase.value }))

  return <Animated.View style={animatedStyle}>{children}</Animated.View>
}
