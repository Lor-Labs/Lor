import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { type ReactNode, useRef } from "react"
import { Text } from "react-native"
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable"
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableScale } from "@/components/ui/pressable-scale"

const ACTION_WIDTH = 88

// A list row with one action under it, revealed by a swipe to the left (take
// someone out, leave). Without an action it is the row alone.
export function SwipeRow({
  action,
  children,
}: {
  action?: {
    label: string
    icon: IconSvgElement
    color: string
    onPress: () => void
  }
  children: ReactNode
}) {
  const ref = useRef<SwipeableMethods>(null)
  if (!action) return <>{children}</>
  return (
    <ReanimatedSwipeable
      friction={1.6}
      onSwipeableWillOpen={() => triggerHaptic("light")}
      overshootRight={false}
      ref={ref}
      renderRightActions={(progress) => (
        <Action
          {...action}
          onPress={() => {
            ref.current?.close()
            action.onPress()
          }}
          progress={progress}
        />
      )}
      rightThreshold={ACTION_WIDTH * 0.5}
    >
      {children}
    </ReanimatedSwipeable>
  )
}

function Action({
  label,
  icon,
  color,
  onPress,
  progress,
}: {
  label: string
  icon: IconSvgElement
  color: string
  onPress: () => void
  progress: SharedValue<number>
}) {
  const reveal = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [0, 1], "clamp"),
    transform: [
      { scale: interpolate(progress.get(), [0, 1], [0.7, 1], "clamp") },
    ],
  }))
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      className="items-center justify-center"
      hitSlop={0}
      onPress={onPress}
      scale={0.94}
      style={{ width: ACTION_WIDTH, backgroundColor: color }}
    >
      <Animated.View className="items-center gap-one" style={reveal}>
        <HugeiconsIcon color="#ffffff" icon={icon} size={19} strokeWidth={2} />
        <Text className="text-[12px] font-semibold text-white">{label}</Text>
      </Animated.View>
    </PressableScale>
  )
}
