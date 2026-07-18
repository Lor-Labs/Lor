import {
  getAvatarColorStyle,
  getAvatarInitials,
} from "@repo/utils/avatar-colors"
import {
  type AvatarColor,
  type AvatarRootProps,
  Avatar as HeroAvatar,
  type AvatarSize as HeroAvatarSize,
} from "heroui-native/avatar"
import { cn } from "heroui-native/utils"
import type { ReactNode } from "react"

export type AvatarSize = "xs" | HeroAvatarSize

export type AvatarProps = Omit<AvatarRootProps, "children" | "size"> & {
  fallback?: ReactNode
  image?: string | null
  name: string
  size?: AvatarSize
  color?: AvatarColor
  avatarColor?: string | null
  shape?: "circle" | "square"
}

export function Avatar({
  className,
  avatarColor,
  color = "default",
  fallback,
  image,
  name,
  shape = "circle",
  size = "sm",
  variant = "soft",
  ...props
}: AvatarProps) {
  const heroSize: HeroAvatarSize = size === "xs" ? "sm" : size
  const initial = fallback ?? getAvatarInitials(name)
  const fallbackColors = getAvatarColorStyle(avatarColor, name)

  return (
    <HeroAvatar
      {...props}
      className={cn(
        shape === "circle" ? "rounded-full" : "rounded-lor-sm",
        size === "xs" && "size-8",
        className
      )}
      color={color}
      size={heroSize}
      variant={variant}
    >
      {image ? <HeroAvatar.Image source={{ uri: image }} /> : null}
      <HeroAvatar.Fallback
        classNames={{
          container: shape === "circle" ? "rounded-full" : "rounded-lor-sm",
        }}
        styles={{
          container: { backgroundColor: fallbackColors.backgroundColor },
          text: { color: fallbackColors.foregroundColor },
        }}
      >
        {initial}
      </HeroAvatar.Fallback>
    </HeroAvatar>
  )
}
