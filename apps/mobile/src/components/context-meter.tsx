import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Text, View } from "react-native"
import Svg, { Circle } from "react-native-svg"
import { PressableScale } from "@/components/ui/pressable-scale"
import {
  type ThreadContextUsage,
  useThreadContext,
} from "@/hooks/use-thread-context"

// Compact token formatting: the meter is about magnitude, not accounting.
function formatTokens(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`
  const millions = n / 1_000_000
  return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`
}

const SEGMENT_META = [
  { key: "system", label: "System" },
  { key: "tools", label: "Tools" },
  { key: "messages", label: "Messages" },
] as const

// Lighter to full, in the order the rows are listed; Messages, last, is the
// full accent.
const SHADES = [0.3, 0.45, 0.6, 0.75, 0.9]

type Segment = { key: string; label: string; value: number; opacity: number }

function segmentsOf(data: ThreadContextUsage): Segment[] {
  const categories = data.categories
  const rows = categories
    ? categories.map((category, index) => ({
        key: category.name,
        label: category.name,
        value: category.tokens,
        opacity:
          index === categories.length - 1
            ? 1
            : (SHADES[index % SHADES.length] ?? 1),
      }))
    : SEGMENT_META.map((meta, index) => ({
        ...meta,
        value: data.segments[meta.key],
        opacity: index === SEGMENT_META.length - 1 ? 1 : (SHADES[index] ?? 1),
      }))
  return rows.filter((segment) => segment.value > 0)
}

const RING = 18
const STROKE = 2.5
const RADIUS = (RING - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function Ring({ fraction }: { fraction: number }) {
  const [accent, track] = useThemeColor(["accent", "border"])
  return (
    <Svg
      height={RING}
      style={{ transform: [{ rotate: "-90deg" }] }}
      width={RING}
    >
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        fill="none"
        r={RADIUS}
        stroke={track}
        strokeWidth={STROKE}
      />
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        fill="none"
        r={RADIUS}
        stroke={accent}
        strokeDasharray={`${CIRCUMFERENCE * fraction} ${CIRCUMFERENCE}`}
        strokeLinecap="round"
        strokeWidth={STROKE}
      />
    </Svg>
  )
}

// A ring and percentage in the session composer's bar: how full the model's
// context window is, so you can see when to compact or change model before
// a turn runs out. Tapping it lists what fills the window. Hidden until Lor
// has run here. Mirrors web's context-meter.tsx, whose hover card is this
// sheet.
export function ContextMeter({
  scopeKey,
  isRunning,
}: {
  scopeKey: string | undefined
  isRunning: boolean
}) {
  const { data } = useThreadContext(scopeKey, isRunning)
  const [open, setOpen] = useState(false)
  if (!data?.available) return null

  const fraction = Math.min(1, data.usedTokens / data.windowTokens)
  const percent = Math.round(fraction * 100)

  return (
    <View>
      <PressableScale
        accessibilityHint="Shows what fills the context window"
        accessibilityLabel={`Context ${percent}% full`}
        accessibilityRole="button"
        className="min-h-9 flex-row items-center gap-[6px] rounded-full pl-two pr-one"
        onPress={() => setOpen(true)}
        scale={0.94}
      >
        <Ring fraction={fraction} />
        <Text
          className="text-[13px] font-medium text-muted"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {percent}%
        </Text>
      </PressableScale>
      <ContextSheet
        data={data}
        isOpen={open}
        onOpenChange={setOpen}
        percent={percent}
      />
    </View>
  )
}

function ContextSheet({
  data,
  percent,
  isOpen,
  onOpenChange,
}: {
  data: ThreadContextUsage
  percent: number
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}) {
  const accent = useThemeColor("accent")
  const segments = segmentsOf(data)
  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content enableDynamicSizing={false} snapPoints={["46%"]}>
          <BottomSheetScrollView
            contentContainerStyle={{ gap: 16, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            <View className="flex-row items-center px-one">
              <BottomSheet.Title className="flex-1">Context</BottomSheet.Title>
              <Text
                className="text-[15px] font-semibold text-foreground"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {percent}% full
              </Text>
            </View>
            <View
              accessibilityElementsHidden
              className="mx-one h-2 flex-row overflow-hidden rounded-full bg-surface-secondary"
              importantForAccessibility="no-hide-descendants"
            >
              {segments.map((segment) => (
                <View
                  key={segment.key}
                  style={{
                    backgroundColor: accent,
                    opacity: segment.opacity,
                    width: `${(segment.value / data.windowTokens) * 100}%`,
                  }}
                />
              ))}
            </View>
            <View className="gap-two px-one">
              {segments.map((segment) => (
                <View
                  className="flex-row items-center gap-two"
                  key={segment.key}
                >
                  <View
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: accent,
                      opacity: segment.opacity,
                    }}
                  />
                  <Text className="min-w-0 flex-1 text-[15px] text-muted">
                    {segment.label}
                  </Text>
                  <Text
                    className="text-[15px] text-foreground"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {formatTokens(segment.value)}
                  </Text>
                </View>
              ))}
              <View className="mt-one flex-row items-center border-t border-separator pt-three">
                <Text className="flex-1 text-[15px] text-muted">Total</Text>
                <Text
                  className="text-[15px] font-medium text-foreground"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {formatTokens(data.usedTokens)} /{" "}
                  {formatTokens(data.windowTokens)}
                </Text>
              </View>
              {data.creditsSpent === null ? null : (
                <View className="flex-row items-center">
                  <Text className="flex-1 text-[15px] text-muted">Cost</Text>
                  <Text
                    className="text-[15px] text-foreground"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {data.creditsSpent.toLocaleString()}{" "}
                    {data.creditsSpent === 1 ? "credit" : "credits"}
                  </Text>
                </View>
              )}
            </View>
            {data.compacted ? (
              <Text className="px-one text-[13px] leading-[18px] text-muted">
                Compacted: {formatTokens(data.rawHistoryTokens)} of history is
                kept as working notes. The full transcript is preserved.
              </Text>
            ) : null}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}
