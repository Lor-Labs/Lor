import Download01Icon from "@hugeicons/core-free-icons/Download01Icon"
import File01Icon from "@hugeicons/core-free-icons/File01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Image, Pressable, Text, View } from "react-native"
import { ImageViewer } from "@/components/image-viewer"
import type { Message } from "@/lib/api-types"
import { openExternalUrl } from "@/lib/open-url"

type Attachments = NonNullable<Message["attachments"]>
type Attachment = Attachments[number]

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileLabel(attachment: Attachment) {
  if (attachment.contentType.startsWith("video/")) return "Video"
  if (attachment.contentType.startsWith("audio/")) return "Audio"
  const extension = attachment.filename.split(".").at(-1)
  return extension && extension !== attachment.filename
    ? extension.toUpperCase()
    : "File"
}

export function MessageAttachments({
  attachments,
}: {
  attachments: Attachments
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [foreground, muted] = useThemeColor(["foreground", "muted"])
  const images = attachments.filter((attachment) =>
    attachment.contentType.startsWith("image/")
  )
  const files = attachments.filter(
    (attachment) => !attachment.contentType.startsWith("image/")
  )

  return (
    <View className="mt-one gap-one">
      {images.length === 1 ? (
        <Pressable
          accessibilityHint="Opens the image"
          accessibilityLabel={images[0]?.filename}
          accessibilityRole="imagebutton"
          className="max-w-[360px] overflow-hidden rounded-lor-sm bg-surface-secondary"
          onPress={() => setViewerIndex(0)}
        >
          <Image
            accessibilityLabel={images[0]?.filename}
            resizeMode="contain"
            source={{ uri: images[0]?.url }}
            style={{ height: 220, width: "100%" }}
          />
        </Pressable>
      ) : images.length > 1 ? (
        <View className="max-w-[360px] flex-row flex-wrap gap-one">
          {images.map((image, index) => (
            <Pressable
              accessibilityHint="Opens the image"
              accessibilityLabel={image.filename}
              accessibilityRole="imagebutton"
              className="aspect-square w-[49%] overflow-hidden rounded-lor-sm bg-surface-secondary"
              key={image.url}
              onPress={() => setViewerIndex(index)}
            >
              <Image
                accessibilityLabel={image.filename}
                resizeMode="cover"
                source={{ uri: image.url }}
                style={{ height: "100%", width: "100%" }}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
      {files.map((attachment) => (
        <Pressable
          accessibilityHint="Opens the attachment"
          accessibilityLabel={`${attachment.filename}, ${fileLabel(attachment)}, ${formatFileSize(attachment.size)}`}
          accessibilityRole="link"
          className="max-w-[420px] flex-row items-center gap-three rounded-lor-sm border border-border bg-surface-secondary p-three"
          key={attachment.url}
          onPress={() => openExternalUrl(attachment.url)}
        >
          <View className="size-10 items-center justify-center rounded-lor-sm bg-default">
            <HugeiconsIcon color={foreground} icon={File01Icon} size={20} />
          </View>
          <View className="min-w-0 flex-1 gap-px">
            <Text
              className="text-sm font-semibold text-foreground"
              numberOfLines={1}
            >
              {attachment.filename}
            </Text>
            <Text className="text-xs text-muted">
              {fileLabel(attachment)} · {formatFileSize(attachment.size)}
            </Text>
          </View>
          <HugeiconsIcon color={muted} icon={Download01Icon} size={17} />
        </Pressable>
      ))}
      {viewerIndex !== null ? (
        <ImageViewer
          images={images}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  )
}
