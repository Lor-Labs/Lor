import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"

// A past call's actions on long-press, like a channel's. Only Delete so far,
// so the sheet sizes to its content.
export function CallActionsSheet({
  isOpen,
  title,
  description,
  onOpenChange,
  onDelete,
}: {
  isOpen: boolean
  title: string
  description: string
  onOpenChange: (isOpen: boolean) => void
  onDelete: () => void
}) {
  const danger = useThemeColor("danger")
  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content>
          <View className="gap-six" style={{ paddingBottom: 40 }}>
            <View className="flex-row items-start gap-three px-one">
              <View className="min-w-0 flex-1 gap-px">
                <BottomSheet.Title numberOfLines={1}>{title}</BottomSheet.Title>
                <BottomSheet.Description numberOfLines={1}>
                  {description}
                </BottomSheet.Description>
              </View>
              <BottomSheet.Close />
            </View>
            <Pressable
              accessibilityLabel="Delete call"
              accessibilityRole="button"
              className="mx-one min-h-14 flex-row items-center gap-three rounded-lor-sm bg-surface-secondary px-three py-three active:bg-surface-tertiary"
              onPress={onDelete}
            >
              <View className="size-9 items-center justify-center rounded-lor-sm bg-danger-soft">
                <HugeiconsIcon color={danger} icon={Delete02Icon} size={19} />
              </View>
              <View className="min-w-0 flex-1 gap-px">
                <Text className="text-[15px] font-semibold text-danger">
                  Delete call
                </Text>
                <Text className="text-xs leading-4 text-muted">
                  Chat, transcript, and summary too. You can undo.
                </Text>
              </View>
            </Pressable>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}
