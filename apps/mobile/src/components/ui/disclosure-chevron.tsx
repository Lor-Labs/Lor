import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import type { ViewStyle } from "react-native"
import Animated, {
  type CSSStyle,
  useReducedMotion,
} from "react-native-reanimated"
import { CSS_EASE_OUT, STATE_MS } from "@/lib/motion"

const TURN: CSSStyle<ViewStyle> = {
  transitionProperty: "transform",
  transitionDuration: STATE_MS,
  transitionTimingFunction: CSS_EASE_OUT,
}

// A fold's chevron: down while open, turned to the side while closed. It
// turns rather than swapping, so the eye sees which way the rows went.
export function DisclosureChevron({
  open,
  color,
  size = 12,
}: {
  open: boolean
  color: string
  size?: number
}) {
  const reduced = useReducedMotion()
  return (
    <Animated.View
      style={[
        TURN,
        // With reduced motion it still shows the state, without the turn.
        reduced ? { transitionDuration: 0 } : null,
        { transform: [{ rotate: open ? "0deg" : "-90deg" }] },
      ]}
    >
      <HugeiconsIcon
        color={color}
        icon={ArrowDown01Icon}
        size={size}
        strokeWidth={2.2}
      />
    </Animated.View>
  )
}
