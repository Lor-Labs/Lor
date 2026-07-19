import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"

export function UserAvatar({
  src,
  name,
  avatarColor,
  size = "md",
  className,
}: {
  src?: string | null
  name?: string | null
  avatarColor?: string | null
  size?: "sm" | "md"
  className?: string
}) {
  return (
    <Avatar
      className={cn("shrink-0", size === "sm" ? "size-8" : "size-9", className)}
    >
      {src && <AvatarImage src={src} alt={name ?? ""} />}
      <AvatarFallback
        avatarColor={avatarColor}
        fallbackSeed={name ?? "avatar"}
        className={cn(
          "font-semibold",
          size === "sm" ? "text-xs" : "text-[13px]"
        )}
      >
        {getAvatarInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
