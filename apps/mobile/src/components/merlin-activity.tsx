import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { Shimmer } from "@/components/shimmer"

// Mobile port of web's merlin-activity.tsx outer collapsible: the work log
// wrapping everything before a Merlin message's final answer. Auto-opens while
// the run streams and collapses at the run boundary; manual toggles win
// mid-run. Single-level on mobile — the reasoning and tool-trail rows inside
// carry their own disclosures, so web's inner group tier is skipped.
export function MerlinActivity({
  active,
  failed,
  toolCount,
  errorCount,
  children,
}: {
  active: boolean
  failed: boolean
  toolCount: number
  errorCount: number
  children: ReactNode
}) {
  const muted = useThemeColor("muted")
  const [wasActive, setWasActive] = useState(active)
  const [open, setOpen] = useState(active)
  if (wasActive !== active) {
    setWasActive(active)
    setOpen(active)
  }

  const label = active
    ? "Working…"
    : failed
      ? "Work interrupted"
      : toolCount > 0
        ? "Worked"
        : "Thought process"

  return (
    <View className="mb-one">
      <Pressable
        accessibilityLabel={label}
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
        {active ? (
          <Shimmer>
            <Text className="text-xs text-muted">{label}</Text>
          </Shimmer>
        ) : (
          <Text className="text-xs text-muted">{label}</Text>
        )}
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
