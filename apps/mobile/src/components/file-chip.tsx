import { Pressable, Text, View } from "react-native"
import { FileTypeIcon } from "@/components/file-type-icon"
import { formatFileSize } from "@/components/message-attachments"

// A chip's detail line, e.g. "CSV · 12.0 KB" (web's describeFile).
export function describeFile(name: string, size: number | null) {
  const extension = name.includes(".")
    ? name.split(".").pop()?.toUpperCase()
    : undefined
  const type = extension || "File"
  return size === null ? type : `${type} · ${formatFileSize(size)}`
}

// One file as a bordered row: type icon, name and detail line. Lor's files
// and uploads look the same everywhere, as on web.
export function FileChip({
  name,
  size,
  onPress,
}: {
  name: string
  size: number | null
  onPress?: () => void
}) {
  const detail = describeFile(name, size)
  return (
    <Pressable
      accessibilityHint="Opens the file"
      accessibilityLabel={`${name}, ${detail}`}
      accessibilityRole="button"
      className="flex-row items-center gap-three rounded-lor-md border border-border bg-surface px-three py-two active:bg-surface-secondary"
      disabled={!onPress}
      onPress={onPress}
    >
      <FileTypeIcon filename={name} />
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {name}
        </Text>
        <Text className="text-xs text-muted">{detail}</Text>
      </View>
    </Pressable>
  )
}
