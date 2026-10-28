import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text } from "react-native"

// A pick in a session's destination line (repo, branch, agent, model),
// styled like the channel's. It opens that pick's sheet.
export function TargetChip({
  label,
  icon,
  hint,
  onPress,
}: {
  label: string
  icon?: IconSvgElement
  hint: string
  onPress: () => void
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityRole="button"
      className="min-h-8 max-w-full flex-row items-center gap-one rounded-lor-sm px-one active:bg-accent-soft"
      hitSlop={6}
      onPress={onPress}
    >
      {icon ? (
        <HugeiconsIcon color={accent} icon={icon} size={13} strokeWidth={2} />
      ) : null}
      <Text
        className="shrink text-[13px] font-semibold text-accent"
        numberOfLines={1}
      >
        {label}
      </Text>
      <HugeiconsIcon color={muted} icon={ArrowDown01Icon} size={12} />
    </Pressable>
  )
}
