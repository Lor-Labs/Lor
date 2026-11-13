import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { formatWorkTime } from "@repo/utils/date"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useState } from "react"
import { Pressable, Text, View } from "react-native"

// Work log ahead of a Lor message's answer (web lor-activity.tsx port).
// Auto-opens while streaming and retains the work on failure; manual
// toggles win mid-run. Single-level on mobile — the rows inside carry their
// own disclosures, so web's inner group tier is skipped.
export function LorActivity({
  active,
  failed,
  toolCount,
  errorCount,
  workedMs = null,
  children,
}: {
  active: boolean
  failed: boolean
  toolCount: number
  errorCount: number
  // The run's wall-clock time once it settled; null for older replies.
  workedMs?: number | null
  children: ReactNode
}) {
  const muted = useThemeColor("muted")
  const [wasActive, setWasActive] = useState(active)
  const [open, setOpen] = useState(active || failed)
  if (wasActive !== active) {
    setWasActive(active)
    setOpen(active || failed)
  }

  // While the run is live, LorWorkingFor shows the elapsed time above the reply;
  // once it settles, this activity label shows the final duration.
  const took = workedMs !== null ? formatWorkTime(workedMs) : null
  const label = active
    ? "Activity"
    : failed
      ? took
        ? `Work interrupted after ${took}`
        : "Work interrupted"
      : toolCount > 0
        ? took
          ? `Worked for ${took}`
          : "Worked"
        : took
          ? `Thought for ${took}`
          : "Thought process"

  const accessibilityLabel = [
    label,
    toolCount > 0
      ? `${toolCount} tool ${toolCount === 1 ? "call" : "calls"}`
      : null,
    errorCount > 0 ? `${errorCount} failed` : null,
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <View className="mb-one">
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="min-h-8 flex-row items-center gap-one self-start"
        onPress={() => setOpen((current) => !current)}
      >
        <HugeiconsIcon
          color={muted}
          icon={ArrowRight01Icon}
          size={13}
          style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}
        />
        <Text className="text-xs text-muted">{label}</Text>
        {toolCount > 0 ? (
          <Text className="text-xs text-muted">
            · {toolCount} tool {toolCount === 1 ? "call" : "calls"}
          </Text>
        ) : null}
        {errorCount > 0 ? (
          <Text className="text-xs text-danger">· {errorCount} failed</Text>
        ) : null}
      </Pressable>
      {open ? (
        <View className="ml-one border-l border-border pl-three">
          {children}
          <Pressable
            accessibilityRole="button"
            className="min-h-7 justify-center self-start"
            onPress={() => setOpen(false)}
          >
            <Text className="text-[11px] text-muted">Hide activity</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}
