import { useEffect, useRef } from "react"
import {
  Pressable,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native"
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { Shimmer } from "@/components/shimmer"
import { useTheme } from "@/hooks/use-theme"

type PrefillInputProps = Omit<
  TextInputProps,
  "value" | "onChangeText" | "className" | "style"
> & {
  value: string
  onChangeText: (value: string) => void
  /** The looked-up value on screen, or null once the user has typed. */
  prefill: string | null
  /** Pulsing stand-in for the placeholder while the lookup runs. */
  pendingLabel: string | null
}

// Onboarding field the company-site lookup can fill. The chrome is a separate
// view so the filled text can fade in without fading the border.
export function PrefillInput({
  value,
  onChangeText,
  prefill,
  pendingLabel,
  placeholder,
  ...props
}: PrefillInputProps) {
  const theme = useTheme()
  const reduceMotion = useReducedMotion()
  const inputRef = useRef<TextInput>(null)
  const textOpacity = useSharedValue(1)

  useEffect(() => {
    if (!prefill || reduceMotion) return
    textOpacity.value = 0
    textOpacity.value = withTiming(1, { duration: 280 })
  }, [prefill, reduceMotion, textOpacity])

  const textStyle = useAnimatedStyle(() => ({ opacity: textOpacity.value }))
  const showPending = pendingLabel !== null && value === ""

  return (
    <Pressable
      accessible={false}
      className="min-h-[52px] flex-row items-center rounded-lor-md border border-border bg-surface px-three"
      onPress={() => inputRef.current?.focus()}
    >
      <Animated.View className="flex-1 self-stretch" style={textStyle}>
        <TextInput
          ref={inputRef}
          className="flex-1 text-[16px] text-foreground"
          value={value}
          onChangeText={onChangeText}
          placeholder={showPending ? undefined : placeholder}
          {...props}
        />
      </Animated.View>
      {showPending ? (
        <View
          className="absolute inset-y-0 left-three justify-center"
          pointerEvents="none"
        >
          <Shimmer>
            <Text className="text-[16px]" style={{ color: theme.textTertiary }}>
              {pendingLabel}
            </Text>
          </Shimmer>
        </View>
      ) : null}
    </Pressable>
  )
}
