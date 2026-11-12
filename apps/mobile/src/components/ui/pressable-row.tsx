import { cn } from "heroui-native/utils"
import { type ComponentProps, useState } from "react"
import { Pressable, type ViewStyle } from "react-native"
import Animated, { type CSSStyle } from "react-native-reanimated"
import { CSS_EASE_OUT, SCROLL_PRESS_DELAY_MS } from "@/lib/motion"

type PressableRowProps = Omit<ComponentProps<typeof Pressable>, "children"> & {
  children?: React.ReactNode
  className?: string
  // The highlight's fill and shape, e.g. another radius.
  highlightClassName?: string
  // The row opened the screen now on top: it stays highlighted until you
  // come back, then fades (see useOpenedRow).
  selected?: boolean
}

const LONG_PRESS_MS = 500

const HIGHLIGHT: CSSStyle<ViewStyle> = {
  transitionProperty: "opacity",
  transitionTimingFunction: CSS_EASE_OUT,
}
// Like a native list row: the highlight is there at once and fades out
// after the finger lifts.
const SHOWN: CSSStyle<ViewStyle> = { opacity: 1, transitionDuration: 40 }
const HIDDEN: CSSStyle<ViewStyle> = { opacity: 0, transitionDuration: 280 }

// A list row's press feedback: a highlight behind the content that fades
// rather than snapping. Rows don't shrink (that is for buttons). The
// highlight waits out the start of a scroll (SCROLL_PRESS_DELAY_MS), so
// scrolling a list never flashes its rows.
export function PressableRow({
  children,
  className,
  highlightClassName,
  selected = false,
  onPressIn,
  onPressOut,
  disabled,
  delayLongPress,
  ...props
}: PressableRowProps) {
  const [pressed, setPressed] = useState(false)
  return (
    <Pressable
      {...props}
      className={className}
      // The long press counts from the touch, as callers mean it; Pressable
      // would start counting only after the press delay.
      delayLongPress={Math.max(
        10,
        (delayLongPress ?? LONG_PRESS_MS) - SCROLL_PRESS_DELAY_MS
      )}
      disabled={disabled}
      onPressIn={(event) => {
        setPressed(true)
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        setPressed(false)
        onPressOut?.(event)
      }}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
    >
      <Animated.View
        className={cn(
          "absolute inset-0 rounded-lor-md bg-surface-secondary",
          highlightClassName
        )}
        pointerEvents="none"
        style={[HIGHLIGHT, (pressed || selected) && !disabled ? SHOWN : HIDDEN]}
      />
      {children}
    </Pressable>
  )
}
