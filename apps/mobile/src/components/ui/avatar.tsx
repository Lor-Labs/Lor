import {
  type AvatarColor,
  type AvatarRootProps,
  Avatar as HeroAvatar,
  type AvatarSize as HeroAvatarSize,
} from "heroui-native/avatar"
import { cn } from "heroui-native/utils"

export type AvatarSize = "xs" | HeroAvatarSize

export type AvatarProps = Omit<AvatarRootProps, "children" | "size"> & {
  fallback?: string
  image?: string | null
  name: string
  size?: AvatarSize
  color?: AvatarColor
}

export function Avatar({
  className,
  color = "default",
  fallback,
  image,
  name,
  size = "sm",
  variant = "soft",
  ...props
}: AvatarProps) {
  const heroSize: HeroAvatarSize = size === "xs" ? "sm" : size
  const initial = fallback ?? (name.trim().charAt(0).toUpperCase() || "?")

  return (
    <HeroAvatar
      {...props}
      className={cn("rounded-lor-sm", size === "xs" && "size-8", className)}
      color={color}
      size={heroSize}
      variant={variant}
    >
      {image ? <HeroAvatar.Image source={{ uri: image }} /> : null}
      <HeroAvatar.Fallback classNames={{ container: "rounded-lor-sm" }}>
        {initial}
      </HeroAvatar.Fallback>
    </HeroAvatar>
  )
}
