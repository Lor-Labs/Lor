import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon"
import File01Icon from "@hugeicons/core-free-icons/File01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { formatFileSize } from "@/components/message-attachments"
import type { ChannelTask, TaskPlanItem } from "@/lib/api-types"
import { openExternalUrl } from "@/lib/open-url"

const STATUS_META: Record<
  ChannelTask["status"],
  { label: string; container: string; text: string; running?: boolean }
> = {
  running: {
    label: "Running",
    container: "bg-accent-soft",
    text: "text-accent",
    running: true,
  },
  waiting_for_input: {
    label: "Waiting on the team",
    container: "bg-warning-soft",
    text: "text-warning-soft-foreground",
  },
  waiting_for_approval: {
    label: "Needs approval",
    container: "bg-warning-soft",
    text: "text-warning-soft-foreground",
  },
  completed: {
    label: "Completed",
    container: "bg-success-soft",
    text: "text-success-soft-foreground",
  },
  failed: {
    label: "Failed",
    container: "bg-danger-soft",
    text: "text-danger-soft-foreground",
  },
  stopped: {
    label: "Stopped",
    container: "bg-surface-secondary",
    text: "text-muted",
  },
}

export function TaskStatusBadge({ status }: { status: ChannelTask["status"] }) {
  const accent = useThemeColor("accent")
  const meta = STATUS_META[status]
  return (
    <View
      className={`flex-row items-center gap-one rounded-full px-two py-one ${meta.container}`}
    >
      {meta.running ? <ActivityIndicator color={accent} size="small" /> : null}
      <Text className={`text-[11px] font-semibold ${meta.text}`}>
        {meta.label}
      </Text>
    </View>
  )
}

function PlanMarker({ status }: { status: TaskPlanItem["status"] }) {
  const [success, accent] = useThemeColor(["success", "accent"])
  if (status === "done") {
    return (
      <HugeiconsIcon color={success} icon={CheckmarkCircle02Icon} size={15} />
    )
  }
  if (status === "active") {
    return <ActivityIndicator color={accent} size="small" />
  }
  return (
    <View className="size-[9px] rounded-full border-[1.5px] border-border" />
  )
}

export function TaskPlanList({ items }: { items: TaskPlanItem[] }) {
  if (items.length === 0) return null
  return (
    <View className="gap-one">
      {items.map((item, idx) => (
        <View
          className="flex-row items-start gap-two"
          key={`${idx}:${item.text}`}
        >
          <View className="h-5 w-4 items-center justify-center">
            <PlanMarker status={item.status} />
          </View>
          <Text
            className={`min-w-0 flex-1 text-sm leading-5 ${
              item.status === "active" ? "text-foreground" : "text-muted"
            }`}
          >
            {item.text}
          </Text>
        </View>
      ))}
    </View>
  )
}

// Compact file row for task deliverables. Files open in the in-app browser
// sheet — mobile has no artifact viewer yet, by decision.
export function TaskFileRow({
  name,
  size,
  url,
  onOpen,
}: {
  name: string
  size: number | null
  url: string | null
  // Fired just before the browser sheet opens — lets a hosting popover close.
  onOpen?: () => void
}) {
  const muted = useThemeColor("muted")
  return (
    <Pressable
      accessibilityLabel={`Open ${name}`}
      accessibilityRole="link"
      className="min-h-8 flex-row items-center gap-two rounded-lor-sm border border-border bg-background px-two py-one"
      disabled={!url}
      onPress={() => {
        if (!url) return
        onOpen?.()
        openExternalUrl(url)
      }}
    >
      <HugeiconsIcon color={muted} icon={File01Icon} size={14} />
      <Text
        className="min-w-0 flex-1 text-[13px] font-medium text-foreground"
        numberOfLines={1}
      >
        {name}
      </Text>
      {size !== null ? (
        <Text className="text-[11px] text-muted">{formatFileSize(size)}</Text>
      ) : null}
    </Pressable>
  )
}
