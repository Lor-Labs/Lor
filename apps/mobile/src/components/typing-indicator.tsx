import { useEffect, useState } from "react"
import { Text } from "react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"

type TypingUser = {
  userId: string
  name: string
}

function formatTypingText(users: TypingUser[]) {
  const first = users[0]
  const second = users[1]
  if (!first) return ""
  if (users.length === 1) return `${first.name} is typing`
  if (users.length === 2 && second)
    return `${first.name} and ${second.name} are typing`
  return `${first.name} and ${users.length - 1} others are typing`
}

function TypingDots() {
  const [count, setCount] = useState(1)

  useEffect(() => {
    const interval = setInterval(
      () => setCount((current) => (current % 3) + 1),
      350
    )
    return () => clearInterval(interval)
  }, [])

  return (
    <Text className="w-3 text-xs font-semibold text-muted">
      {".".repeat(count)}
    </Text>
  )
}

export function TypingIndicator({ users }: { users: TypingUser[] }) {
  if (users.length === 0) return null

  return (
    <Animated.View
      className="h-5 flex-row items-center gap-one px-four"
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
    >
      <Text
        accessibilityLiveRegion="polite"
        className="shrink text-xs text-muted"
        numberOfLines={1}
      >
        {formatTypingText(users)}
      </Text>
      <TypingDots />
    </Animated.View>
  )
}
