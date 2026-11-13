import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Text, View } from "react-native"
import { PressableScale } from "@/components/ui/pressable-scale"

// A pick above a session's composer (channel, repo, branch): a pill the same
// size and look as the model chip beside it, so every choice for the session
// reads as one row of buttons. It opens that pick's sheet; without
// `onPress` it only shows a fixed value.
export function TargetChip({
  label,
  icon,
  hint,
  onPress,
}: {
  label: string
  icon?: IconSvgElement
  hint: string
  onPress?: () => void
}) {
  const muted = useThemeColor("muted")
  const content = (
    <>
      {icon ? (
        <HugeiconsIcon color={muted} icon={icon} size={14} strokeWidth={2} />
      ) : null}
      <Text
        className="shrink text-[13px] font-semibold text-foreground"
        numberOfLines={1}
      >
        {label}
      </Text>
      {onPress ? (
        <HugeiconsIcon color={muted} icon={ArrowDown01Icon} size={12} />
      ) : null}
    </>
  )
  const className =
    "min-h-9 max-w-full flex-row items-center gap-[6px] rounded-full border border-border bg-surface px-three"
  if (!onPress) {
    return (
      <View accessibilityLabel={label} className={className}>
        {content}
      </View>
    )
  }
  return (
    <PressableScale
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="button"
      className={className}
      onPress={onPress}
    >
      {content}
    </PressableScale>
  )
}
