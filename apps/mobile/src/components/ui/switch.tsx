import { Switch as HeroSwitch } from "heroui-native/switch"
import type { ComponentProps } from "react"
import { triggerToggleHaptic } from "@/components/ui/haptics"

type SwitchProps = ComponentProps<typeof HeroSwitch>

function SwitchRoot({ onSelectedChange, ...props }: SwitchProps) {
  return (
    <HeroSwitch
      {...props}
      onSelectedChange={(isSelected) => {
        triggerToggleHaptic(isSelected)
        onSelectedChange?.(isSelected)
      }}
    />
  )
}

export const Switch = Object.assign(SwitchRoot, {
  Thumb: HeroSwitch.Thumb,
  StartContent: HeroSwitch.StartContent,
  EndContent: HeroSwitch.EndContent,
})
