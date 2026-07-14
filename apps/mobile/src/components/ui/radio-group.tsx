import { RadioGroup as HeroRadioGroup } from "heroui-native/radio-group"
import type { ComponentProps } from "react"
import { triggerHaptic } from "@/components/ui/haptics"

type RadioGroupProps = ComponentProps<typeof HeroRadioGroup>

function RadioGroupRoot({ onValueChange, ...props }: RadioGroupProps) {
  return (
    <HeroRadioGroup
      {...props}
      onValueChange={(value) => {
        triggerHaptic("selection")
        onValueChange(value)
      }}
    />
  )
}

export const RadioGroup = Object.assign(RadioGroupRoot, {
  Item: HeroRadioGroup.Item,
})
