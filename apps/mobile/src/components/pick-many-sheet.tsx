import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useEffect, useState } from "react"
import { Text, View } from "react-native"
import Animated from "react-native-reanimated"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import { POP_ENTER, POP_EXIT } from "@/lib/motion"

export type PickManyItem = {
  id: string
  name: string
  detail?: string | null
  face: ReactNode
}

// Picking several from a list in a sheet (people or agents to add to a
// chat): a tap ticks one, the button beside the title adds them all. A search field shows
// once the list is long.
export function PickManySheet({
  isOpen,
  onOpenChange,
  title,
  items,
  confirmLabel,
  onConfirm,
  busy = false,
  max,
  emptyText = "Nobody left to add",
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  title: string
  items: PickManyItem[]
  // The button's word: "Add" becomes "Add 2".
  confirmLabel: string
  onConfirm: (ids: string[]) => void
  busy?: boolean
  // How many can be picked at most.
  max?: number
  emptyText?: string
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const [picked, setPicked] = useState<string[]>([])
  const [query, setQuery] = useState("")
  useEffect(() => {
    if (!isOpen) {
      setPicked([])
      setQuery("")
    }
  }, [isOpen])
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? items.filter((item) => item.name.toLowerCase().includes(needle))
    : items
  const full = max !== undefined && picked.length >= max

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          contentContainerClassName="h-full"
          enableDynamicSizing={false}
          enableOverDrag={false}
          keyboardBehavior="extend"
          snapPoints={["70%"]}
        >
          <View className="flex-row items-center gap-two px-one pb-three">
            <BottomSheet.Title className="flex-1">{title}</BottomSheet.Title>
            <Button
              isDisabled={picked.length === 0 || busy}
              onPress={() => onConfirm(picked)}
              size="sm"
            >
              {busy
                ? "Adding…"
                : picked.length > 0
                  ? `${confirmLabel} ${picked.length}`
                  : confirmLabel}
            </Button>
          </View>
          {items.length > 8 ? (
            <View className="mx-one mb-two h-11 flex-row items-center gap-two rounded-lor-sm bg-surface-secondary px-three">
              <HugeiconsIcon color={muted} icon={Search01Icon} size={16} />
              <BottomSheetTextInput
                accessibilityLabel="Find by name"
                autoCapitalize="none"
                autoCorrect={false}
                className="h-full min-w-0 flex-1 p-0 text-[16px] text-foreground"
                onChangeText={setQuery}
                placeholder="Find by name"
                placeholderTextColor={muted}
                selectionColor={accent}
                value={query}
              />
            </View>
          ) : null}
          <BottomSheetScrollView
            contentContainerStyle={{ paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {shown.length === 0 ? (
              <Text className="px-three py-four text-sm text-muted">
                {items.length === 0 ? emptyText : "Nobody by that name."}
              </Text>
            ) : null}
            {shown.map((item) => {
              const on = picked.includes(item.id)
              return (
                <PressableRow
                  accessibilityLabel={item.name}
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: on,
                    disabled: !on && full,
                  }}
                  className={`min-h-14 flex-row items-center gap-three rounded-lor-md px-three py-two ${
                    !on && full ? "opacity-40" : ""
                  }`}
                  disabled={!on && full}
                  key={item.id}
                  onPress={() => {
                    triggerHaptic("selection")
                    setPicked((list) =>
                      on
                        ? list.filter((id) => id !== item.id)
                        : [...list, item.id]
                    )
                  }}
                >
                  <View className="size-9 items-center justify-center">
                    {item.face}
                  </View>
                  <View className="min-w-0 flex-1 gap-px">
                    <Text
                      className="text-[16px] text-foreground"
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {item.detail ? (
                      <Text className="text-xs text-muted" numberOfLines={1}>
                        {item.detail}
                      </Text>
                    ) : null}
                  </View>
                  <View
                    className={`size-6 items-center justify-center rounded-full border-[1.5px] ${
                      on ? "border-accent bg-accent" : "border-border"
                    }`}
                  >
                    {on ? (
                      <Animated.View entering={POP_ENTER} exiting={POP_EXIT}>
                        <HugeiconsIcon
                          color="#ffffff"
                          icon={Tick02Icon}
                          size={14}
                          strokeWidth={2.6}
                        />
                      </Animated.View>
                    ) : null}
                  </View>
                </PressableRow>
              )
            })}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}
