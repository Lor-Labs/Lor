import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"

export type PickerOption = {
  value: string
  label: string
  detail?: string
  // A short tag after the label ("default").
  badge?: string | null
}

// One choice from a list in a bottom sheet (a session's repo, branch or
// agent), with a search field when `search` is set. With `onQueryChange` the
// caller filters on the server; otherwise the list filters here.
export function PickerSheet({
  isOpen,
  onOpenChange,
  title,
  options,
  selected,
  onPick,
  search,
  loading = false,
  emptyText = "Nothing found",
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  title: string
  options: PickerOption[]
  selected: string | null
  onPick: (value: string) => void
  search?: { placeholder: string; onQueryChange?: (query: string) => void }
  loading?: boolean
  emptyText?: string
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const [query, setQuery] = useState("")
  const changeQuery = (next: string) => {
    setQuery(next)
    search?.onQueryChange?.(next)
  }
  const needle = query.trim().toLowerCase()
  const shown =
    search && !search.onQueryChange && needle
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options

  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!next) changeQuery("")
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
          snapPoints={["60%"]}
        >
          <View className="flex-row items-center px-one pb-three">
            <BottomSheet.Title className="flex-1">{title}</BottomSheet.Title>
            <BottomSheet.Close />
          </View>
          {search ? (
            <View className="mx-one mb-two h-11 flex-row items-center gap-two rounded-lor-sm border border-border bg-surface-secondary px-three">
              <HugeiconsIcon color={muted} icon={Search01Icon} size={16} />
              <BottomSheetTextInput
                accessibilityLabel={search.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                className="h-full min-w-0 flex-1 p-0 text-[16px] text-foreground"
                onChangeText={changeQuery}
                placeholder={search.placeholder}
                placeholderTextColor={muted}
                selectionColor={accent}
                value={query}
              />
              {loading ? <Spinner size="sm" /> : null}
            </View>
          ) : null}
          <BottomSheetScrollView
            contentContainerStyle={{ paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {shown.length === 0 && !loading ? (
              <Text className="px-three py-three text-sm text-muted">
                {emptyText}
              </Text>
            ) : null}
            {shown.map((option) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: option.value === selected }}
                className="min-h-12 flex-row items-center gap-two rounded-lor-sm px-three py-two active:bg-surface-secondary"
                key={option.value}
                onPress={() => {
                  onPick(option.value)
                  changeQuery("")
                }}
              >
                <View className="min-w-0 flex-1 gap-px">
                  <Text
                    className="text-[15px] text-foreground"
                    numberOfLines={1}
                  >
                    {option.label}
                    {option.badge ? (
                      <Text className="text-xs text-muted">
                        {"  "}
                        {option.badge}
                      </Text>
                    ) : null}
                  </Text>
                  {option.detail ? (
                    <Text className="text-xs text-muted">{option.detail}</Text>
                  ) : null}
                </View>
                {option.value === selected ? (
                  <HugeiconsIcon color={accent} icon={Tick02Icon} size={18} />
                ) : null}
              </Pressable>
            ))}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}
