import { Message01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@repo/ui/components/preview-card"
import { Skeleton } from "@repo/ui/components/skeleton"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarColorStyle } from "@repo/utils/avatar-colors"
import { features } from "@repo/utils/features"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { useOpenDM } from "@/hooks/use-create-dm"
import { apiClient } from "@/lib/api-client"

function ProfileCardContent({
  avatarColor,
  userId,
}: {
  avatarColor?: string | null
  userId: string
}) {
  const { data: session } = authClient.useSession()

  const { data, isPending, isError } = useQuery({
    queryKey: ["user-profile", userId],
    queryFn: async () => {
      const res = await apiClient.v1.users[":userId"].$get({
        param: { userId },
      })
      if (!res.ok) throw new Error("Failed to fetch user profile")
      return res.json()
    },
  })

  const { openDM, isPending: isOpeningDM } = useOpenDM()

  if (isPending) {
    return (
      <div className="flex w-full flex-col">
        <Skeleton className="-mx-4 -mt-4 h-14 rounded-none rounded-t-[calc(var(--radius-lg)-1px)]" />
        <Skeleton className="-mt-7 mb-3 size-16 rounded-full ring-4 ring-popover" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-3 w-16 rounded" />
        </div>
        <Skeleton className="mt-4 h-8 w-full rounded" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="text-sm text-muted-foreground">
        Failed to load profile.
      </div>
    )
  }

  const user = data.user
  const isCurrentUser = session?.user?.id === userId
  const isMutating = isOpeningDM
  const isOnline = user.presenceStatus === "online"
  const banner = getAvatarColorStyle(avatarColor, user.name)

  return (
    <div className="flex w-full flex-col">
      <div
        className={cn(
          "-mx-4 -mt-4 h-14 rounded-t-[calc(var(--radius-lg)-1px)]",
          user.isBot && "bg-primary"
        )}
        style={
          user.isBot ? undefined : { backgroundColor: banner.backgroundColor }
        }
      />
      <div className="relative -mt-7 mb-3 w-fit">
        <UserAvatar
          avatarColor={avatarColor}
          className="size-16 ring-4 ring-popover"
          name={user.name}
          src={user.image}
        />
        <span
          className={cn(
            "absolute bottom-0 right-0 size-4 rounded-full border-[3px] border-popover",
            isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
          )}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="truncate text-base font-semibold leading-tight">
          {user.name}
        </span>
        {isCurrentUser && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            You
          </Badge>
        )}
        {user.isBot && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            Agent
          </Badge>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {isOnline ? "Online" : "Offline"}
      </p>

      {user.status && (
        <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2">
          <p className="line-clamp-2 text-[13px] font-medium text-foreground/90">
            {user.status}
          </p>
        </div>
      )}

      {/*{user.isBot && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <HugeiconsIcon icon={BotIcon} className="size-3.5" strokeWidth={2} />
          Workspace agent
        </div>
      )}*/}

      {features.directMessages && !isCurrentUser && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-3">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 w-full gap-2"
            disabled={isMutating}
            onClick={() => openDM(userId)}
          >
            <HugeiconsIcon
              icon={Message01Icon}
              className="size-4"
              strokeWidth={2}
            />
            Message
          </Button>
        </div>
      )}
    </div>
  )
}

// Hover twin of UserProfilePopover (Notion-mention style) — same card, shown
// after a 500ms hover instead of a click (matches the @mention hover cards).
// Content mounts on open, so the profile fetch only happens when the card
// actually shows.
export function UserHoverCard({
  avatarColor,
  userId,
  children,
}: {
  avatarColor?: string | null
  userId: string
  children: React.ReactElement
}) {
  return (
    <HoverCard>
      <HoverCardTrigger delay={500} closeDelay={100} render={children} />
      <HoverCardContent side="top" align="start" className="w-72">
        <ProfileCardContent avatarColor={avatarColor} userId={userId} />
      </HoverCardContent>
    </HoverCard>
  )
}

export function UserProfilePopover({
  avatarColor,
  userId,
  children,
  side = "right",
  align = "start",
}: {
  avatarColor?: string | null
  userId: string
  children: React.ReactElement
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={children} />
      <PopoverContent
        side={side}
        align={align}
        className="w-72"
        initialFocus={false}
      >
        {open && (
          <ProfileCardContent avatarColor={avatarColor} userId={userId} />
        )}
      </PopoverContent>
    </Popover>
  )
}
