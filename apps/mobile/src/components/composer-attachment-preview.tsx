import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import File01Icon from "@hugeicons/core-free-icons/File01Icon"
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon"
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
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

// Bottom-edge bar, mirroring web's attachment tiles. Progress is 0–1 here (web
// carries 0–100), so it's converted rather than reused directly.
function UploadProgressBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.min(1, Math.max(0, value))
  const percent = Math.round(clamped * 100)
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      accessibilityLiveRegion="polite"
      className="absolute inset-x-0 bottom-0 h-1 bg-border"
    >
      <View className="h-full bg-foreground" style={{ width: `${percent}%` }} />
    </View>
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
  const isUploading = attachment.status === "uploading"
  const previewUri = attachment.url ?? attachment.uri
  const previewFailed = failedPreviewUri === previewUri

  // Images speak for themselves as a square; files need their name and size.
  // Both are 60px tall so a mixed row lines up — same as web.
  return (
    <View
      className={`relative shrink-0 overflow-visible ${
        isImage ? "size-15" : "h-15 w-[220px]"
      }`}
    >
      <View
        className={`size-full overflow-hidden rounded-lor-sm border bg-background ${
          isUploadError ? "border-danger" : "border-border"
        }`}
      >
        {isImage ? (
          <View className="size-full bg-default">
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
                // Dimmed while bytes are still going out, so the tile reads as
                // in-flight at a glance and the bar stays legible over it.
                opacity: isUploadError ? 0.5 : isUploading ? 0.65 : 1,
                width: "100%",
              }}
            />
          </View>
        ) : (
          <View
            className={`size-full flex-row items-center gap-two p-two ${
              isUploadError ? "opacity-50" : ""
            }`}
          >
            <View className="size-11 items-center justify-center rounded-lor-sm border border-border bg-default">
              <HugeiconsIcon color={foreground} icon={File01Icon} size={20} />
            </View>
            <View className="min-w-0 flex-1">
              <Text
                className="text-[13px] font-medium text-foreground"
                numberOfLines={1}
              >
                {attachment.filename}
              </Text>
              <Text className="text-[11px] text-muted">
                {formatFileSize(attachment.size)}
              </Text>
            </View>
          </View>
        )}

        {isUploading ? (
          <UploadProgressBar
            label={`Uploading ${attachment.filename}, ${Math.round(
              attachment.progress * 100
            )} percent`}
            value={attachment.progress}
          />
        ) : null}

        {isUploadError ? (
          <Pressable
            accessibilityHint={attachment.error}
            accessibilityLabel={`Retry ${attachment.filename}`}
            accessibilityRole="button"
            className="absolute inset-0 flex-row items-center justify-center gap-one bg-danger-soft/80"
            onPress={() => onRetry(attachment.id)}
          >
            <HugeiconsIcon color={danger} icon={RefreshIcon} size={18} />
            <Text className="text-[11px] font-semibold text-danger">Retry</Text>
          </Pressable>
        ) : null}
      </View>

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
