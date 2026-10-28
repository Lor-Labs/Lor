import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
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
// agent), with a search field when `search` is set. The list filters here as
// you type; `onQueryChange` lets the caller also search the server and add
// its results. With `create`, a typed name that matches no option gets a
// last row to make it.
export function PickerSheet({
  isOpen,
  onOpenChange,
  title,
  options,
  selected,
  onPick,
  search,
  create,
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
  create?: {
    // The row's text for a typed name; null: the name can't be made.
    label: (name: string) => string | null
    onCreate: (name: string) => void
  }
  loading?: boolean
  emptyText?: string
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const [query, setQuery] = useState("")
  const changeQuery = (next: string) => {
    setQuery(next)
    search?.onQueryChange?.(next)
  }
  const typed = query.trim()
  const needle = typed.toLowerCase()
  const shown =
    search && needle
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options
  const createLabel =
    create && typed && !options.some((option) => option.value === typed)
      ? create.label(typed)
      : null

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
            {shown.length === 0 && !loading && !createLabel ? (
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
            {create && createLabel ? (
              <Pressable
                accessibilityRole="button"
                className="min-h-12 flex-row items-center gap-two rounded-lor-sm px-three py-two active:bg-surface-secondary"
                onPress={() => {
                  create.onCreate(typed)
                  changeQuery("")
                }}
              >
                <HugeiconsIcon color={accent} icon={PlusSignIcon} size={18} />
                <Text
                  className="min-w-0 flex-1 text-[15px] text-foreground"
                  numberOfLines={1}
                >
                  {createLabel}
                </Text>
              </Pressable>
            ) : null}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}
