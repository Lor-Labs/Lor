import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import FlashIcon from "@hugeicons/core-free-icons/FlashIcon"
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { KEY_PROVIDER_NAMES } from "@repo/utils/inference"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { HarnessLogo } from "@/components/harness-logo"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import { PressableScale } from "@/components/ui/pressable-scale"
import { Switch } from "@/components/ui/switch"
import {
  type AgentModelOption,
  type ModelChoice,
  rememberPick,
} from "@/hooks/use-agent-models"
import { HARNESS_LABELS, type SessionHarness } from "@/lib/harness"

// The model, thinking effort and fast mode for the turn a message starts:
// one chip in the composer that opens one sheet, as web's model-picker.tsx
// does in one popover. A new code session's sheet also picks the agent. The
// lists come from the harness's own catalog, so nothing here names a model.

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

export type HarnessTab = {
  value: SessionHarness
  label: string
  detail: string
}

export function ModelPicker({
  choice,
  harnesses,
  onHarness,
}: {
  choice: ModelChoice
  // A new code session: the agents to pick from, as tabs in the sheet.
  harnesses?: HarnessTab[]
  onHarness?: (harness: SessionHarness) => void
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const [open, setOpen] = useState(false)
  const { option, harness } = choice
  const showsEffort = Boolean(option && option.efforts.length > 0)

  return (
    // One box for the chip and its sheet, so the sheet's own wrapper never
    // counts as an item in the row of chips.
    <View className="max-w-full">
      <PressableScale
        accessibilityHint="Chooses the model, thinking effort and fast mode for your messages"
        accessibilityLabel={[
          `${HARNESS_LABELS[harness]} model: ${option?.name ?? "default"}`,
          showsEffort
            ? `effort: ${choice.effort ? effortLabel(choice.effort) : "default"}`
            : null,
          choice.fast ? "fast mode on" : null,
        ]
          .filter(Boolean)
          .join(", ")}
        accessibilityRole="button"
        className="min-h-9 max-w-full flex-row items-center gap-two rounded-full border border-border bg-surface px-three"
        onPress={() => setOpen(true)}
      >
        <HarnessLogo harness={harness} size={14} />
        <Text
          className="shrink text-[13px] font-semibold text-foreground"
          numberOfLines={1}
        >
          {option?.name ?? "Model"}
        </Text>
        {showsEffort ? (
          <Text className="text-[13px] text-muted">
            {choice.effort ? effortLabel(choice.effort) : "Default"}
          </Text>
        ) : null}
        {choice.fast ? (
          <HugeiconsIcon
            color={accent}
            icon={FlashIcon}
            size={13}
            strokeWidth={2}
          />
        ) : null}
        <HugeiconsIcon color={muted} icon={ArrowDown01Icon} size={12} />
      </PressableScale>
      <ModelSheet
        choice={choice}
        harnesses={harnesses}
        isOpen={open}
        onHarness={onHarness}
        onOpenChange={setOpen}
      />
    </View>
  )
}

type ModelGroup = { label: string | null; models: AgentModelOption[] }

// A harness's models by who pays, as on web: Lor's list splits into a group
// per workspace key and one on Lor credits; a single group has no label.
function modelGroups(models: AgentModelOption[]): ModelGroup[] {
  const payers = [...new Set(models.map((model) => model.keyProvider))]
  return payers.map((payer) => ({
    label:
      payers.length < 2
        ? null
        : payer
          ? `${KEY_PROVIDER_NAMES[payer]} key`
          : "Lor credits",
    models: models.filter((model) => model.keyProvider === payer),
  }))
}

function modelDetail(model: AgentModelOption): string | null {
  const exact =
    model.resolvedModel && model.resolvedModel !== model.id
      ? model.resolvedModel
      : null
  return [model.description, exact].filter(Boolean).join(" · ") || null
}

function ModelSheet({
  choice,
  harnesses,
  onHarness,
  isOpen,
  onOpenChange,
}: {
  choice: ModelChoice
  harnesses?: HarnessTab[]
  onHarness?: (harness: SessionHarness) => void
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const [query, setQuery] = useState("")
  const { option, catalog, harness } = choice
  const needle = query.trim().toLowerCase()
  const models = (catalog?.models ?? []).filter(
    (model) =>
      !needle ||
      [model.name, model.id, model.description, model.provider]
        .join(" ")
        .toLowerCase()
        .includes(needle)
  )
  const groups = modelGroups(models)
  const efforts = option?.efforts ?? []
  const harnessDefault = catalog?.defaultEffort == null
  const effortChoices: { value: string | null; label: string }[] = [
    ...(harnessDefault ? [{ value: null, label: "Default" }] : []),
    ...efforts.map((level) => ({ value: level, label: effortLabel(level) })),
  ]
  const tabs = harnesses && harnesses.length > 1 ? harnesses : null
  const tabDetail = tabs?.find((tab) => tab.value === harness)?.detail

  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!next) setQuery("")
        onOpenChange(next)
      }}
    >
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          // Its list scrolls only inside a bounded content container
          // (HeroUI's bottom-sheet docs, "Scrollable with Snap Points").
          contentContainerClassName="h-full"
          enableDynamicSizing={false}
          enableOverDrag={false}
          // The composer's keyboard would cover the list.
          onAnimate={(fromIndex, toIndex) => {
            if (fromIndex !== -1 || toIndex < 0) return
            requestAnimationFrame(() => {
              void KeyboardController.dismiss().catch(() => undefined)
            })
          }}
          snapPoints={["82%"]}
        >
          <View className="flex-row items-center px-one pb-three">
            <BottomSheet.Title className="flex-1">Model</BottomSheet.Title>
            <PressableScale
              accessibilityRole="button"
              className="min-h-9 justify-center px-two"
              feedback="dim"
              onPress={() => onOpenChange(false)}
            >
              <Text className="text-[15px] font-semibold text-accent">
                Done
              </Text>
            </PressableScale>
          </View>
          {tabs ? (
            <View className="mb-three gap-two">
              <View
                accessibilityRole="tablist"
                className="mx-one flex-row gap-one rounded-lor-sm bg-surface-secondary p-one"
              >
                {tabs.map((tab) => {
                  const selected = tab.value === harness
                  return (
                    <PressableScale
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      // Sized by its name, not in equal thirds: "Claude
                      // Code" needs more room than "Lor".
                      className={`min-h-10 grow flex-row items-center justify-center gap-[6px] rounded-lor-sm px-two ${
                        selected ? "bg-surface" : ""
                      }`}
                      hitSlop={0}
                      key={tab.value}
                      onPress={() => {
                        if (selected) return
                        triggerHaptic("soft")
                        setQuery("")
                        onHarness?.(tab.value)
                      }}
                    >
                      <HarnessLogo harness={tab.value} size={15} />
                      <Text
                        className={`shrink text-[13px] font-semibold ${
                          selected ? "text-foreground" : "text-muted"
                        }`}
                        numberOfLines={1}
                      >
                        {tab.label}
                      </Text>
                    </PressableScale>
                  )
                })}
              </View>
              {tabDetail ? (
                <Text className="px-three text-xs text-muted">{tabDetail}</Text>
              ) : null}
            </View>
          ) : null}
          {/* The picked model's own settings, above the list so they are in
              reach however long the list is and whatever the sheet's height.
              They follow the pick: tap a model, then set how it thinks. */}
          {option && (efforts.length > 0 || option.fast) ? (
            <View className="mb-three gap-three">
              {efforts.length > 0 ? (
                <View className="gap-two">
                  <Text className="px-three text-xs font-semibold text-muted">
                    Thinking effort
                  </Text>
                  <ScrollView
                    contentContainerClassName="gap-[6px] px-one"
                    horizontal
                    keyboardShouldPersistTaps="handled"
                    showsHorizontalScrollIndicator={false}
                  >
                    {effortChoices.map((level) => {
                      const selected = level.value === choice.effort
                      return (
                        <PressableScale
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          className={`min-h-9 justify-center rounded-full border px-three ${
                            selected
                              ? "border-accent bg-accent-soft"
                              : "border-border"
                          }`}
                          hitSlop={4}
                          key={level.value ?? "default"}
                          onPress={() => {
                            if (selected) return
                            triggerHaptic("selection")
                            rememberPick(choice, { effort: level.value })
                          }}
                        >
                          <Text
                            className={`text-[13px] font-semibold ${
                              selected ? "text-accent" : "text-foreground"
                            }`}
                          >
                            {level.label}
                          </Text>
                        </PressableScale>
                      )
                    })}
                  </ScrollView>
                </View>
              ) : null}
              {option.fast ? (
                <View className="flex-row items-center gap-three px-three">
                  <View className="min-w-0 flex-1 gap-px">
                    <Text className="text-[15px] text-foreground">
                      Fast mode
                    </Text>
                    <Text className="text-xs text-muted">
                      Faster output from the same model, at a higher price. On a
                      Claude plan it uses extra usage.
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel="Fast mode"
                    isSelected={choice.fast}
                    onSelectedChange={(fast) => rememberPick(choice, { fast })}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          <View className="mx-one mb-two h-11 flex-row items-center gap-two rounded-lor-sm border border-border bg-surface-secondary px-three">
            <HugeiconsIcon color={muted} icon={Search01Icon} size={16} />
            <BottomSheetTextInput
              accessibilityLabel="Find a model"
              autoCapitalize="none"
              autoCorrect={false}
              className="h-full min-w-0 flex-1 p-0 text-[16px] text-foreground"
              onChangeText={setQuery}
              placeholder="Find a model"
              placeholderTextColor={muted}
              selectionColor={accent}
              value={query}
            />
            {catalog || choice.catalogFailed ? null : <Spinner size="sm" />}
          </View>
          <BottomSheetScrollView
            contentContainerStyle={{ paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {choice.catalogFailed ? (
              <PressableRow
                accessibilityRole="button"
                className="px-three py-three"
                onPress={choice.retryCatalog}
              >
                <Text className="text-sm text-muted">
                  Couldn't load the models.{" "}
                  <Text className="font-semibold text-accent">Try again</Text>
                </Text>
              </PressableRow>
            ) : null}
            {catalog && models.length === 0 ? (
              <Text className="px-three py-three text-sm text-muted">
                No models match
              </Text>
            ) : null}
            {groups.map((group) => (
              <View key={group.label ?? "all"}>
                {group.label ? (
                  <View className="flex-row items-center gap-one px-three pt-three pb-one">
                    {group.models[0]?.keyProvider ? (
                      <HugeiconsIcon color={muted} icon={Key01Icon} size={12} />
                    ) : null}
                    <Text className="text-xs font-semibold text-muted">
                      {group.label}
                    </Text>
                  </View>
                ) : null}
                {group.models.map((model) => {
                  const selected = model.id === option?.id
                  const detail = modelDetail(model)
                  return (
                    <PressableRow
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      className={`min-h-12 flex-row items-center gap-two rounded-lor-sm px-three py-two ${
                        selected ? "bg-accent-soft" : ""
                      }`}
                      highlightClassName="rounded-lor-sm"
                      key={model.id}
                      onPress={() => {
                        if (selected) return
                        triggerHaptic("soft")
                        rememberPick(choice, { model: model.id })
                      }}
                    >
                      <View className="min-w-0 flex-1 gap-px">
                        <Text
                          className="text-[15px] text-foreground"
                          numberOfLines={1}
                        >
                          {model.name}
                        </Text>
                        {detail ? (
                          <Text className="text-xs text-muted">{detail}</Text>
                        ) : null}
                      </View>
                      {selected ? (
                        <HugeiconsIcon
                          color={accent}
                          icon={Tick02Icon}
                          size={18}
                        />
                      ) : null}
                    </PressableRow>
                  )
                })}
              </View>
            ))}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}
