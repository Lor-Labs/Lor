import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import File01Icon from "@hugeicons/core-free-icons/File01Icon"
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { Image } from "expo-image"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { Pressable, ScrollView, Text, View } from "react-native"
import { IconButton } from "@/components/ui/icon-button"
import type { PendingMessageAttachment } from "@/hooks/use-message-attachments"

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ComposerAttachmentPreview({
  attachments,
  onRemove,
  onRetry,
}: {
  attachments: PendingMessageAttachment[]
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}) {
  const [foreground, background, danger] = useThemeColor([
    "foreground",
    "background",
    "danger",
  ])
  if (attachments.length === 0) return null

  return (
    <ScrollView
      className="max-h-24"
      contentContainerClassName="gap-two px-three pb-one pt-three"
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
    >
      {attachments.map((attachment) => {
        const isImage = attachment.contentType.startsWith("image/")
        const isError = attachment.status === "error"
        return (
          <View
            className={`relative size-20 shrink-0 overflow-visible rounded-lor-sm border bg-background ${
              isError ? "border-danger" : "border-border"
            }`}
            key={attachment.id}
          >
            {isImage ? (
              <Image
                accessibilityLabel={attachment.filename}
                className={`size-full rounded-lor-sm ${isError ? "opacity-50" : ""}`}
                contentFit="cover"
                source={{ uri: attachment.uri }}
              />
            ) : (
              <View
                className={`size-full items-center justify-center gap-one p-two ${isError ? "opacity-50" : ""}`}
              >
                <View className="size-8 items-center justify-center rounded-lor-sm bg-default">
                  <HugeiconsIcon
                    color={foreground}
                    icon={File01Icon}
                    size={17}
                  />
                </View>
                <Text
                  className="w-full text-center text-[10px] font-semibold text-foreground"
                  numberOfLines={1}
                >
                  {attachment.filename}
                </Text>
                <Text className="text-[9px] text-muted">
                  {formatFileSize(attachment.size)}
                </Text>
              </View>
            )}

            {attachment.status === "uploading" ? (
              <View className="absolute inset-0 items-center justify-center rounded-lor-sm bg-background/70">
                <Spinner color={foreground} size="sm" />
                <Text className="mt-one text-[9px] font-semibold text-muted">
                  {Math.round(attachment.progress * 100)}%
                </Text>
              </View>
            ) : null}

            {isError ? (
              <Pressable
                accessibilityHint={attachment.error}
                accessibilityLabel={`Retry ${attachment.filename}`}
                accessibilityRole="button"
                className="absolute inset-0 items-center justify-center rounded-lor-sm bg-danger-soft/80"
                onPress={() => onRetry(attachment.id)}
              >
                <HugeiconsIcon color={danger} icon={RefreshIcon} size={20} />
                <Text className="mt-one text-[9px] font-semibold text-danger">
                  Retry
                </Text>
              </Pressable>
            ) : null}

            <IconButton
              accessibilityLabel={`Remove ${attachment.filename}`}
              className="absolute -right-two -top-two size-7 border border-border bg-foreground"
              onPress={() => onRemove(attachment.id)}
              size="sm"
              variant="ghost"
            >
              <HugeiconsIcon color={background} icon={Cancel01Icon} size={13} />
            </IconButton>
          </View>
        )
      })}
    </ScrollView>
  )
}
