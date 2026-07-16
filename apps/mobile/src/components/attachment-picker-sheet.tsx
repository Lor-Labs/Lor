import Camera01Icon from "@hugeicons/core-free-icons/Camera01Icon"
import FileAttachmentIcon from "@hugeicons/core-free-icons/FileAttachmentIcon"
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"

export function AttachmentPickerSheet({
  isOpen,
  onOpenChange,
  onPickFiles,
  onPickPhotos,
  onTakePhoto,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onPickFiles: () => Promise<void>
  onPickPhotos: () => Promise<void>
  onTakePhoto: () => Promise<void>
}) {
  const foreground = useThemeColor("foreground")

  const choose = (action: () => Promise<void>) => {
    onOpenChange(false)
    setTimeout(() => void action(), 160)
  }

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay />
        <BottomSheet.Content snapPoints={["40%"]}>
          <View className="gap-one px-one pb-six">
            <View className="mb-two flex-row items-start gap-three">
              <View className="min-w-0 flex-1 gap-one">
                <BottomSheet.Title>Add attachment</BottomSheet.Title>
                <BottomSheet.Description>
                  Share a photo or file in this conversation.
                </BottomSheet.Description>
              </View>
              <BottomSheet.Close />
            </View>
            <AttachmentAction
              color={foreground}
              detail="Choose one or more images"
              icon={Image01Icon}
              label="Photo library"
              onPress={() => choose(onPickPhotos)}
            />
            <AttachmentAction
              color={foreground}
              detail="Take a new photo"
              icon={Camera01Icon}
              label="Camera"
              onPress={() => choose(onTakePhoto)}
            />
            <AttachmentAction
              color={foreground}
              detail="PDFs, documents, audio, and more"
              icon={FileAttachmentIcon}
              label="Choose file"
              onPress={() => choose(onPickFiles)}
            />
            <Text className="mt-one px-three text-xs text-muted">
              Up to 10 files, 20 MB each
            </Text>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function AttachmentAction({
  color,
  detail,
  icon,
  label,
  onPress,
}: {
  color: string
  detail: string
  icon: IconSvgElement
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityHint={detail}
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-16 flex-row items-center gap-three rounded-lor-sm px-three py-two active:bg-surface-secondary"
      onPress={onPress}
    >
      <View className="size-10 items-center justify-center rounded-lor-sm bg-default">
        <HugeiconsIcon color={color} icon={icon} size={20} strokeWidth={1.8} />
      </View>
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-[15px] font-semibold text-foreground">
          {label}
        </Text>
        <Text className="text-xs text-muted">{detail}</Text>
      </View>
    </Pressable>
  )
}
