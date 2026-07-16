import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import File01Icon from "@hugeicons/core-free-icons/File01Icon"
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon"
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useState } from "react"
import { Image, Pressable, ScrollView, Text, View } from "react-native"
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
      {attachments.map((attachment) => (
        <AttachmentPreviewItem
          attachment={attachment}
          background={background}
          danger={danger}
          foreground={foreground}
          key={attachment.id}
          onRemove={onRemove}
          onRetry={onRetry}
        />
      ))}
    </ScrollView>
  )
}

function AttachmentPreviewItem({
  attachment,
  background,
  danger,
  foreground,
  onRemove,
  onRetry,
}: {
  attachment: PendingMessageAttachment
  background: string
  danger: string
  foreground: string
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}) {
  const [failedPreviewUri, setFailedPreviewUri] = useState<string | null>(null)
  const isImage = attachment.contentType.startsWith("image/")
  const isUploadError = attachment.status === "error"
  const previewUri = attachment.url ?? attachment.uri
  const previewFailed = failedPreviewUri === previewUri

  return (
    <View
      className={`relative size-20 shrink-0 overflow-visible rounded-lor-sm border bg-background ${
        isUploadError ? "border-danger" : "border-border"
      }`}
    >
      {isImage ? (
        <View className="size-full overflow-hidden rounded-lor-sm bg-default">
          {previewFailed ? (
            <View className="absolute inset-0 items-center justify-center">
              <HugeiconsIcon color={danger} icon={Image01Icon} size={20} />
              <Text className="mt-one text-[9px] font-medium text-muted">
                No preview
              </Text>
            </View>
          ) : null}
          <Image
            accessibilityLabel={attachment.filename}
            key={previewUri}
            onError={() => setFailedPreviewUri(previewUri)}
            resizeMode="cover"
            source={{ uri: previewUri }}
            style={{
              height: "100%",
              opacity: isUploadError ? 0.5 : 1,
              width: "100%",
            }}
          />
        </View>
      ) : (
        <View
          className={`size-full items-center justify-center gap-one p-two ${
            isUploadError ? "opacity-50" : ""
          }`}
        >
          <View className="size-8 items-center justify-center rounded-lor-sm bg-default">
            <HugeiconsIcon color={foreground} icon={File01Icon} size={17} />
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
        <View
          accessibilityLabel={`Uploading ${attachment.filename}, ${Math.round(
            attachment.progress * 100
          )} percent`}
          accessibilityLiveRegion="polite"
          className="absolute inset-0 items-center justify-center rounded-lor-sm bg-background/50"
        >
          <Spinner color={foreground} size="sm" />
          <Text className="mt-one text-[9px] font-semibold text-foreground">
            {Math.round(attachment.progress * 100)}%
          </Text>
        </View>
      ) : null}

      {isUploadError ? (
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
}
