import StopCircleIcon from "@hugeicons/core-free-icons/StopCircleIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Text, View } from "react-native"

// A reply someone stopped on purpose (LOR-142): a quiet note, not an error.
// Web: apps/web/src/components/chat/lor-stopped-note.tsx.
export function LorStoppedNote({ by }: { by: string | null }) {
  const muted = useThemeColor("muted")
  return (
    <View className="mt-one flex-row items-center gap-one self-start">
      <HugeiconsIcon color={muted} icon={StopCircleIcon} size={14} />
      <Text className="text-xs text-muted">
        {by ? `Stopped by ${by}` : "Stopped"}
      </Text>
    </View>
  )
}
