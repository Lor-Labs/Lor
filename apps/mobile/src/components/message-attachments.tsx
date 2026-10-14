import { useState } from "react"
import { Image, Pressable, View } from "react-native"
import { FileChip } from "@/components/file-chip"
import { ImageViewer } from "@/components/image-viewer"
import type { Message } from "@/lib/api-types"
import { openExternalUrl } from "@/lib/open-url"

type Attachments = NonNullable<Message["attachments"]>

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function MessageAttachments({
  attachments,
}: {
  attachments: Attachments
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
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
      {files.length > 0 ? (
        <View className="max-w-[420px] gap-one">
          {files.map((attachment) => (
            <FileChip
              key={attachment.url}
              name={attachment.filename}
              onPress={() => openExternalUrl(attachment.url)}
              size={attachment.size}
            />
          ))}
        </View>
      ) : null}
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
