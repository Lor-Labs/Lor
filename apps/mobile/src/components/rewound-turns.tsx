import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import Undo02Icon from "@hugeicons/core-free-icons/Undo02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"
import type { Message } from "@/lib/api-types"

// A rewind's set-aside turns, folded right under the reply the session went
// back to: collapsed, not hidden, so a shared session shows who rewound and
// what. Mirrors web's rewound-turns.tsx.

// messages[start..end): the set-aside messages, oldest first; messages[end]:
// the newest rewind event of the group. Overlapping rewinds (a second one to
// an earlier reply) fold together.
export type RewoundGroup = {
  start: number
  end: number
  event: Message
  count: number
}

export function rewoundGroups(messages: Message[]): RewoundGroup[] {
  const ranges = messages
    .flatMap((message, end) => {
      if (message.type !== "event" || message.eventType !== "session_rewound") {
        return []
      }
      const to = (message.eventPayload as { toMessageId?: string } | null)
        ?.toMessageId
      // The reply may be on an older page: the fold starts at the top.
      const start = messages.findIndex((candidate) => candidate.id === to) + 1
      return [{ start, end }]
    })
    .sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else merged.push({ ...range })
  }
  return merged.flatMap(({ start, end }) => {
    const event = messages[end]
    if (!event) return []
    const count = messages
      .slice(start, end)
      .filter((message) => message.type !== "event").length
    return [{ start, end, event, count }]
  })
}

export function RewoundTurnsRow({
  group,
  expanded,
  onToggle,
}: {
  group: RewoundGroup
  expanded: boolean
  onToggle: () => void
}) {
  const muted = useThemeColor("muted")
  const hasHistory = group.count > 0
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={hasHistory ? { expanded } : undefined}
      className={`mx-four mt-three flex-row items-center gap-three border border-border bg-surface-secondary px-three py-three ${
        expanded ? "rounded-t-xl" : "mb-three rounded-xl"
      }`}
      disabled={!hasHistory}
      onPress={onToggle}
    >
      <View className="size-7 items-center justify-center rounded-lg border border-border bg-background">
        <HugeiconsIcon
          color={muted}
          icon={Undo02Icon}
          size={14}
          strokeWidth={2}
        />
      </View>
      <View className="min-w-0 flex-1 gap-[2px]">
        <Text className="text-sm font-medium text-foreground">
          Previous history{" "}
          <Text className="text-xs font-normal text-muted">
            {group.count} {group.count === 1 ? "message" : "messages"}
          </Text>
        </Text>
        <Text className="text-xs text-muted" numberOfLines={1}>
          {group.event.author.name} rewound to here
        </Text>
      </View>
      {hasHistory ? (
        <View className="flex-row items-center gap-one">
          <Text className="text-xs text-muted">
            {expanded ? "Hide" : "View"}
          </Text>
          <View style={expanded ? { transform: [{ rotate: "90deg" }] } : null}>
            <HugeiconsIcon
              color={muted}
              icon={ArrowRight01Icon}
              size={14}
              strokeWidth={2}
            />
          </View>
        </View>
      ) : null}
    </Pressable>
  )
}
