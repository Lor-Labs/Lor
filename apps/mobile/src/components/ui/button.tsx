import type { ButtonRootProps } from "heroui-native/button"
import { Button as HeroButton } from "heroui-native/button"
import { cn } from "heroui-native/utils"

export type ButtonProps = ButtonRootProps

function ButtonRoot({ className, ...props }: ButtonProps) {
  return <HeroButton className={cn("rounded-lor-sm", className)} {...props} />
}

export const Button = Object.assign(ButtonRoot, {
  Label: HeroButton.Label,
})
