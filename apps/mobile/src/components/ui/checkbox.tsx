import { Checkbox as HeroCheckbox } from "heroui-native/checkbox"
import type { ComponentProps } from "react"
import { triggerHaptic } from "@/components/ui/haptics"

type CheckboxProps = ComponentProps<typeof HeroCheckbox>

function CheckboxRoot({ onSelectedChange, ...props }: CheckboxProps) {
  return (
    <HeroCheckbox
      {...props}
      onSelectedChange={(isSelected) => {
        triggerHaptic("selection")
        onSelectedChange?.(isSelected)
      }}
    />
  )
}

export const Checkbox = Object.assign(CheckboxRoot, {
  Indicator: HeroCheckbox.Indicator,
})
