import Infinity01Icon from "@hugeicons/core-free-icons/Infinity01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { useThemeColor } from "heroui-native/hooks"
import { Text, View } from "react-native"
import { Button } from "@/components/ui/button"
import { useActivateLoop, useLoopForCard } from "@/hooks/use-loops"
import type { ChannelLoop, Message } from "@/lib/api-types"

// Mirror of web's compact loop pill: icon, name, plain-english schedule,
// status chip — and drafts activate right from the card in the device
// timezone, same as web's quick button. The detail view (full prompt,
// schedule/timezone editor) is still web-only — see
// reference/mobile-parity-todo.md.

const STATUS_META: Record<
  ChannelLoop["status"],
  { label: string; container: string; text: string }
> = {
  draft: {
    label: "Draft",
    container: "bg-surface-secondary",
    text: "text-muted",
  },
  active: {
    label: "Active",
    container: "bg-accent-soft",
    text: "text-accent",
  },
  paused: {
    label: "Paused",
    container: "bg-warning-soft",
    text: "text-warning-soft-foreground",
  },
  completed: {
    label: "Completed",
    container: "bg-success-soft",
    text: "text-success-soft-foreground",
  },
}

export function LoopCard({ message }: { message: Message }) {
  const muted = useThemeColor("muted")
  // Fire markers (type "loop_fire") resolve the loop through the card
  // message they reference; the card itself resolves by its own id.
  const cardMessageId =
    message.type === "loop_fire"
      ? (message.referencedMessageId ?? "")
      : message.id
  const loop = useLoopForCard(message.channelId, cardMessageId)
  const activate = useActivateLoop(loop)

  if (!loop) {
    return (
      <View className="mt-one max-w-[420px] rounded-lor-sm border border-border bg-surface px-three py-two">
        <Text className="text-sm leading-5 text-muted" numberOfLines={2}>
          {message.content ?? "Loop"}
        </Text>
      </View>
    )
  }

  const meta = STATUS_META[loop.status]
  return (
    <View className="mt-one max-w-[420px] flex-row items-center gap-two rounded-lor-sm border border-border bg-surface px-three py-two">
      <View className="size-9 items-center justify-center rounded-lor-sm bg-surface-secondary">
        <HugeiconsIcon color={muted} icon={Infinity01Icon} size={16} />
      </View>
      <View className="min-w-0 flex-1">
        <Text
          className="text-[15px] font-semibold leading-5 text-foreground"
          numberOfLines={1}
        >
          {loop.name}
        </Text>
        <Text className="text-sm leading-5 text-muted" numberOfLines={1}>
          {describeLoopSchedule(loop.schedule, null)}
        </Text>
      </View>
      {loop.status === "draft" ? (
        <Button
          isDisabled={activate.isPending}
          onPress={() => activate.mutate({})}
          size="sm"
        >
          {activate.isPending ? "Working…" : "Create Loop"}
        </Button>
      ) : (
        <View className={`rounded-full px-two py-one ${meta.container}`}>
          <Text className={`text-[11px] font-semibold ${meta.text}`}>
            {meta.label}
          </Text>
        </View>
      )}
    </View>
  )
}
