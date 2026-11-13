import { type ComponentProps, useState } from "react"
import { Pressable, type StyleProp, type ViewStyle } from "react-native"
import Animated, {
  type CSSStyle,
  useReducedMotion,
} from "react-native-reanimated"
import { CSS_EASE_OUT, PRESS_MS } from "@/lib/motion"

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

type PressableScaleProps = Omit<
  ComponentProps<typeof Pressable>,
  "children" | "style"
> & {
  children?: React.ReactNode
  className?: string
  style?: StyleProp<ViewStyle>
  // How far it shrinks while held. Small controls need more to read.
  scale?: number
  // "dim" fades instead of shrinking: for text-only controls (a section
  // header, a link), where a shrink reads as a nudge sideways.
  feedback?: "scale" | "dim"
}

const REST: CSSStyle<ViewStyle> = {
  opacity: 1,
  transform: [{ scale: 1 }],
  transitionProperty: ["transform", "opacity"],
  transitionDuration: PRESS_MS,
  transitionTimingFunction: CSS_EASE_OUT,
}

// Press feedback for buttons and chips: the control shrinks a little while
// held, on press-in rather than on release, so it answers the finger at
// once. Driven by the Pressable's own state (two renders a press), which
// lets go correctly when a scroll takes the touch. With reduced motion it
// dims instead of moving.
export function PressableScale({
  children,
  className,
  style,
  scale = 0.97,
  feedback = "scale",
  hitSlop = 8,
  pressRetentionOffset = 16,
  onPressIn,
  onPressOut,
  disabled,
  ...props
}: PressableScaleProps) {
  const [pressed, setPressed] = useState(false)
  const reduced = useReducedMotion()
  const held = pressed && !disabled
  return (
    <AnimatedPressable
      {...props}
      className={className}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={(event) => {
        setPressed(true)
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        setPressed(false)
        onPressOut?.(event)
      }}
      pressRetentionOffset={pressRetentionOffset}
      style={[
        REST,
        style,
        disabled
          ? { opacity: 0.5 }
          : held
            ? reduced || feedback === "dim"
              ? { opacity: 0.55 }
              : { transform: [{ scale }] }
            : null,
      ]}
    >
      {children}
    </AnimatedPressable>
  )
}
