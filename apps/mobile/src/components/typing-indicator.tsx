import { useEffect, useState } from "react"
import { Text, View } from "react-native"
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated"
import { Avatar } from "@/components/ui/avatar"

type TypingUser = {
  userId: string
  name: string
}

export type TypingPerson = TypingUser & {
  image: string | null
  avatarColor: string | null
}

const MAX_TYPING_LINES = 3
const DOT_DELAYS = [0, 200, 400]
const lineIn = FadeIn.duration(220)
const lineOut = FadeOut.duration(150)
const lineLayout = LinearTransition.duration(220)

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

// Session typing lines: each typer gets a line shaped like a reply, their
// avatar in the gutter and dots where their text will go, right above the
// composer. Mirrors web's DocumentTypingIndicator.
export function DocumentTypingIndicator({
  people,
}: {
  people: TypingPerson[]
}) {
  return (
    <View
      accessibilityLabel={
        people.length > 0 ? formatTypingText(people) : undefined
      }
      accessibilityLiveRegion="polite"
      accessible={people.length > 0}
    >
      {people.slice(0, MAX_TYPING_LINES).map((person) => (
        <Animated.View
          className="flex-row items-center gap-three px-four pb-two"
          entering={lineIn}
          exiting={lineOut}
          key={person.userId}
          layout={lineLayout}
        >
          <Avatar
            avatarColor={person.avatarColor}
            className="size-7"
            image={person.image}
            name={person.name}
            size="xs"
          />
          <View className="h-6 flex-row items-center gap-one">
            {DOT_DELAYS.map((delay) => (
              <BouncingDot delay={delay} key={delay} />
            ))}
          </View>
        </Animated.View>
      ))}
    </View>
  )
}

function BouncingDot({ delay }: { delay: number }) {
  const progress = useSharedValue(0)
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      )
    )
    return () => cancelAnimation(progress)
  }, [delay, progress])
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.65,
    transform: [{ translateY: -2 * progress.value }],
  }))
  return (
    <Animated.View className="size-1.5 rounded-full bg-muted" style={style} />
  )
}
