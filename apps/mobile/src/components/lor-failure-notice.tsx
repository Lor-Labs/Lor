import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Text, View } from "react-native"

// A failed Lor reply reads as an alert, not an answer: its text is the
// worker's failure message (error, out of credits, sandbox capacity).
export function LorFailureNotice({ text }: { text: string }) {
  const [danger] = useThemeColor(["danger"])
  return (
    <View className="flex-row items-start gap-two self-start rounded-lor-sm bg-danger-soft px-three py-two">
      <HugeiconsIcon color={danger} icon={AlertCircleIcon} size={16} />
      <Text className="shrink text-sm text-foreground">{text}</Text>
    </View>
  )
}
