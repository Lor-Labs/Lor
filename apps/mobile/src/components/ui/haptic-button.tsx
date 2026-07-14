import type { ComponentProps } from "react"
import { Button } from "@/components/ui/button"
import { type HapticFeedback, triggerHaptic } from "@/components/ui/haptics"

type HapticButtonProps = ComponentProps<typeof Button> & {
  haptic?: HapticFeedback
}

function HapticButtonRoot({ haptic, onPress, ...props }: HapticButtonProps) {
  return (
    <Button
      {...props}
      onPress={(event) => {
        if (haptic) triggerHaptic(haptic)
        if (typeof onPress === "function") onPress(event)
      }}
    />
  )
}

export const HapticButton = Object.assign(HapticButtonRoot, {
  Label: Button.Label,
})
