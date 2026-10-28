import BrainIcon from "@hugeicons/core-free-icons/BrainIcon"
import FlashIcon from "@hugeicons/core-free-icons/FlashIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { PickerSheet } from "@/components/picker-sheet"
import { TargetChip } from "@/components/target-chip"
import {
  type ModelChoice,
  rememberEffort,
  rememberFast,
  rememberModel,
} from "@/hooks/use-agent-models"
import { HARNESS_LABELS } from "@/lib/harness"

// The model, thinking effort and fast mode for the turn a message starts,
// as on web's model-picker.tsx: chips that open sheets, and a fast toggle.
// The lists come from the harness's own catalog.

const EFFORT_LABELS: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

const effortLabel = (level: string) =>
  EFFORT_LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1)

// The sheet's value for "leave the effort to the harness".
const DEFAULT_EFFORT = "default"

export function ModelChips({
  choice,
  lead,
}: {
  choice: ModelChoice
  // Muted words before the chips ("using").
  lead?: string
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const [sheet, setSheet] = useState<"model" | "effort" | null>(null)
  const { option, catalog, harness } = choice
  const efforts = option?.efforts ?? []
  const harnessDefault = catalog?.defaultEffort == null
  const effortOptions = [
    ...(harnessDefault
      ? [
          {
            value: DEFAULT_EFFORT,
            label: "Default",
            detail: `${HARNESS_LABELS[harness]} picks the effort.`,
          },
        ]
      : []),
    ...efforts.map((level) => ({ value: level, label: effortLabel(level) })),
  ]

  return (
    <View className="flex-row flex-wrap items-center gap-one">
      {lead ? <Text className="text-[13px] text-muted">{lead}</Text> : null}
      <TargetChip
        hint="Chooses the model for your messages"
        label={option?.name ?? "Model"}
        onPress={() => setSheet("model")}
      />
      {efforts.length > 0 ? (
        <TargetChip
          hint="Chooses how much the model thinks"
          icon={BrainIcon}
          label={choice.effort ? effortLabel(choice.effort) : "Default"}
          onPress={() => setSheet("effort")}
        />
      ) : null}
      {option?.fast ? (
        <Pressable
          accessibilityHint="Faster output from the same model, at a higher price. On a Claude plan it uses extra usage."
          accessibilityLabel="Fast mode"
          accessibilityRole="switch"
          accessibilityState={{ checked: choice.fast }}
          className="min-h-8 flex-row items-center gap-one rounded-lor-sm px-one active:bg-accent-soft"
          hitSlop={6}
          onPress={() => rememberFast(harness, !choice.fast)}
        >
          <HugeiconsIcon
            color={choice.fast ? accent : muted}
            icon={FlashIcon}
            size={13}
            strokeWidth={2}
          />
          <Text
            className={`text-[13px] font-semibold ${choice.fast ? "text-accent" : "text-muted"}`}
          >
            Fast
          </Text>
        </Pressable>
      ) : null}
      <PickerSheet
        emptyText="No models match"
        isOpen={sheet === "model"}
        loading={!catalog}
        onOpenChange={(open) => setSheet(open ? "model" : null)}
        onPick={(model) => {
          rememberModel(harness, model)
          setSheet(null)
        }}
        options={(catalog?.models ?? []).map((model) => ({
          value: model.id,
          label: model.name,
          detail: model.description ?? undefined,
        }))}
        search={{ placeholder: "Find a model" }}
        selected={option?.id ?? null}
        title="Model"
      />
      <PickerSheet
        isOpen={sheet === "effort"}
        onOpenChange={(open) => setSheet(open ? "effort" : null)}
        onPick={(value) => {
          rememberEffort(harness, value === DEFAULT_EFFORT ? null : value)
          setSheet(null)
        }}
        options={effortOptions}
        selected={choice.effort ?? DEFAULT_EFFORT}
        title="Thinking effort"
      />
    </View>
  )
}
