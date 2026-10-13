import { timeAgo } from "@repo/utils/date"
import { Text, View } from "react-native"
import { TypewriterText } from "@/components/typewriter-text"
import { Avatar } from "@/components/ui/avatar"

// A session's opening, the first item of its transcript: the title, then one
// quiet line of context. Mirrors web's SessionHeading (session-view.tsx).
export function SessionHeading({
  title,
  generatedTitle,
  channelName,
  startedBy,
  starter,
  createdAt,
}: {
  title: string
  // Lor's title types out; a person's rename shows at once.
  generatedTitle: boolean
  channelName: string
  startedBy: string
  // The person who started it; null for loops and automations.
  starter: {
    name: string
    image: string | null
    avatarColor: string | null
  } | null
  createdAt: string
}) {
  return (
    <View className="px-four pt-five">
      <Text
        accessibilityRole="header"
        className="text-[24px] font-bold leading-[30px] tracking-[-0.4px] text-foreground"
      >
        <TypewriterText animate={generatedTitle} text={title} />
      </Text>
      <View className="mt-two flex-row flex-wrap items-center gap-x-[6px] gap-y-one">
        <Text className="text-sm text-muted">#{channelName}</Text>
        <Text className="text-sm text-muted">·</Text>
        <View className="flex-row items-center gap-[6px]">
          {starter ? (
            <Avatar
              avatarColor={starter.avatarColor}
              className="size-5"
              fallback={starter.name.charAt(0).toUpperCase()}
              image={starter.image}
              name={starter.name}
              size="xs"
            />
          ) : null}
          <Text className="text-sm text-muted">{startedBy}</Text>
        </View>
        <Text className="text-sm text-muted">·</Text>
        <Text className="text-sm text-muted">{timeAgo(createdAt)}</Text>
      </View>
      <View className="mt-five h-px bg-separator" />
    </View>
  )
}
