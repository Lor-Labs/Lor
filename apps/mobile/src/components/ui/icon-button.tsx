import type { ButtonRootProps } from "heroui-native/button"
import { Button } from "@/components/ui/button"

export type IconButtonProps = ButtonRootProps & {
  accessibilityLabel: string
}

export function IconButton({
  hitSlop = 4,
  size = "sm",
  ...props
}: IconButtonProps) {
  return <Button {...props} hitSlop={hitSlop} isIconOnly size={size} />
}
