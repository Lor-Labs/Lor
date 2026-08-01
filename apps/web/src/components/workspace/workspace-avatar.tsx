import { cn } from "@repo/ui/lib/utils"
import { useState } from "react"

type WorkspaceAvatarProps = {
  name?: string | null
  logo?: string | null
  className?: string
  imgClassName?: string
}

/**
 * Org/workspace avatar. Muted neutral initial when the logo is unset or
 * fails to load — intentionally distinct from the colorful user avatars.
 */
export function WorkspaceAvatar({
  name,
  logo,
  className,
  imgClassName,
}: WorkspaceAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showLogo = !!logo && failedSrc !== logo
  const initial = (name?.trim() || "?").charAt(0).toUpperCase()

  return (
    <div
      className={cn(
        "flex aspect-square shrink-0 select-none items-center justify-center overflow-hidden rounded-lg font-semibold",
        showLogo
          ? "p-0.5"
          : "border border-border bg-muted text-muted-foreground",
        className
      )}
    >
      {showLogo ? (
        <img
          src={logo}
          alt=""
          onError={() => setFailedSrc(logo)}
          className={cn("size-full object-contain", imgClassName)}
        />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </div>
  )
}
