import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"

export function LorReasoning({
  text,
  active,
}: {
  text: string
  active: boolean
}) {
  const muted = useThemeColor("muted")
  const [isOpen, setIsOpen] = useState(active)

  useEffect(() => {
    if (!active) setIsOpen(false)
  }, [active])

  return (
    <View className="mb-two">
      <Pressable
        accessibilityLabel={active ? "Thinking" : "Thought process"}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        className="min-h-8 flex-row items-center gap-one self-start"
        onPress={() => setIsOpen((current) => !current)}
      >
        <HugeiconsIcon
          color={muted}
          icon={ArrowRight01Icon}
          size={13}
          style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}
        />
        <Text className="text-xs italic text-muted">
          {active ? "Thinking…" : "Thought process"}
        </Text>
      </Pressable>
      {isOpen ? (
        <View className="ml-one border-l-2 border-border pl-three">
          <Text className="text-xs leading-[18px] text-muted">{text}</Text>
        </View>
      ) : null}
    </View>
  )
}
