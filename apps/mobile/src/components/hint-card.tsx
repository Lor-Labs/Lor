import type { ReactNode } from "react"
import { Pressable, Text } from "react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"

// Mobile's product hint: an inline card rather than web's anchored popover,
// so it never covers the keyboard or the thing it explains. Same delay and
// timing as web.
export function HintCard({
  children,
  onDismiss,
}: {
  children: ReactNode
  onDismiss: () => void
}) {
  return (
    <Animated.View
      className="mb-two flex-row items-center gap-three rounded-lor-sm border border-border bg-surface px-three py-two"
      entering={FadeIn.duration(200).delay(600)}
      exiting={FadeOut.duration(150)}
    >
      <Text className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground">
        {children}
      </Text>
      <Pressable
        accessibilityRole="button"
        className="active:opacity-70"
        hitSlop={8}
        onPress={onDismiss}
      >
        <Text className="text-[13px] font-semibold text-accent">Got it</Text>
      </Pressable>
    </Animated.View>
  )
}
