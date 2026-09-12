import File01Icon from "@hugeicons/core-free-icons/File01Icon"
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { formatFileSize } from "@/components/message-attachments"
import { Shimmer } from "@/components/shimmer"
import type { ChannelPlan, PlanStep } from "@/lib/api-types"
import { openExternalUrl } from "@/lib/open-url"

// Long plans collapse so a 20-step breakdown doesn't bury the delivered files.
const INITIAL_VISIBLE_STEPS = 4

const STATUS_META: Record<
  ChannelPlan["status"],
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

export function PlanStatusBadge({ status }: { status: ChannelPlan["status"] }) {
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

// 24px markers, mirroring web: filled foreground disc with a knocked-out tick
// for done, bordered disc with a spinner while active, empty bordered disc for
// pending. Monochrome throughout — colour is reserved for the status badge.
function PlanMarker({ status }: { status: PlanStep["status"] }) {
  const [foreground, background] = useThemeColor(["foreground", "background"])
  if (status === "done") {
    return (
      <View className="size-6 items-center justify-center rounded-full bg-foreground">
        <HugeiconsIcon
          color={background}
          icon={Tick02Icon}
          size={14}
          strokeWidth={3}
        />
      </View>
    )
  }
  if (status === "active") {
    return (
      <View className="size-6 items-center justify-center rounded-full border border-border bg-background">
        <ActivityIndicator color={foreground} size="small" />
      </View>
    )
  }
  return (
    <View className="size-6 rounded-full border border-border bg-background" />
  )
}

export function PlanStepProgress({ items }: { items: PlanStep[] }) {
  const total = items.length
  const done = items.filter((item) => item.status === "done").length
  const activeIndex = items.findIndex((item) => item.status === "active")

  // Whichever reading is true right now: the step being worked, or the finished
  // count when nothing is active (a plan can wait between steps).
  const label =
    activeIndex >= 0
      ? `Step ${activeIndex + 1} of ${total}`
      : `${done} of ${total} complete`

  return (
    <View className="gap-two">
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </Text>
      {/* A segment per step, so the bar carries the same structure as the list
          below it. Opacity rather than a colour alpha: the theme colours are CSS
          vars, which don't take Tailwind opacity modifiers under NativeWind. */}
      <View className="flex-row gap-one">
        {items.map((item, idx) => (
          <View
            className={`h-1 flex-1 rounded-full bg-foreground ${
              item.status === "done"
                ? "opacity-100"
                : item.status === "active"
                  ? "opacity-40"
                  : "opacity-10"
            }`}
            key={`${idx}:${item.text}`}
          />
        ))}
      </View>
    </View>
  )
}

export function PlanStepList({ items }: { items: PlanStep[] }) {
  const [expanded, setExpanded] = useState(false)
  const muted = useThemeColor("muted")
  if (items.length === 0) return null

  const visible = expanded ? items : items.slice(0, INITIAL_VISIBLE_STEPS)
  const hiddenCount = items.length - visible.length

  return (
    <View>
      {visible.map((item, idx) => {
        const isLast = idx === visible.length - 1 && hiddenCount === 0
        return (
          <View
            className={`flex-row items-start gap-two ${isLast ? "" : "pb-two"}`}
            key={`${idx}:${item.text}`}
          >
            {/* Rail between markers — left-[11px] centres it on the 24px disc. */}
            {isLast ? null : (
              <View className="absolute bottom-0 left-[11px] top-6 w-px bg-border" />
            )}
            <PlanMarker status={item.status} />
            <View className="min-w-0 flex-1">
              <Shimmer active={item.status === "active"}>
                <Text
                  className={`text-sm leading-6 ${
                    item.status === "active"
                      ? "font-medium text-foreground"
                      : "text-muted"
                  }`}
                >
                  {item.text}
                </Text>
              </Shimmer>
              {/* Inline rather than tap-to-expand: descriptions are capped at
                  120 chars, and a disclosure inside the card's Pressable would
                  fight the tap that opens the thread. */}
              {item.description ? (
                <Text
                  className="mt-[2px] text-xs leading-4 text-muted"
                  numberOfLines={2}
                >
                  {item.description}
                </Text>
              ) : null}
            </View>
          </View>
        )
      })}

      {hiddenCount > 0 || expanded ? (
        <Pressable
          accessibilityRole="button"
          className="flex-row items-center gap-two py-one"
          onPress={() => setExpanded((value) => !value)}
        >
          <HugeiconsIcon color={muted} icon={MoreHorizontalIcon} size={16} />
          <Text className="text-sm text-muted">
            {hiddenCount > 0 ? `${hiddenCount} more` : "Show fewer"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

// Compact file row for plan deliverables. Files open in the in-app browser
// sheet — mobile has no artifact viewer yet, by decision.
export function PlanFileRow({
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
