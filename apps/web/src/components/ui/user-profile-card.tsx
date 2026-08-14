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
import { Skeleton } from "@repo/ui/components/skeleton"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import { UserAvatar } from "@/components/ui/user-avatar"
import { apiClient } from "@/lib/api-client"

function ProfileCardContent({
  avatarColor,
  userId,
}: {
  avatarColor?: string | null
  userId: string
}) {
  const queryClient = useQueryClient()
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

  const navigate = useNavigate()

  const createDM = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.dms.$post({
        json: { userIds: [userId] },
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(
          "message" in body ? body.message : "Failed to create DM"
        )
      }
      return res.json()
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["dms"] })
      void navigate({ to: "/dms/$dmId", params: { dmId: data.dm.id } })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  if (isPending) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
        </div>
        <Skeleton className="h-8 w-full rounded" />
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
  const isMutating = createDM.isPending
  const isOnline = user.presenceStatus === "online"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <UserAvatar
            avatarColor={avatarColor}
            className="size-14"
            name={user.name}
            src={user.image}
          />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-[3px] border-popover",
              isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
          />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold leading-tight">
              {user.name}
            </span>
            {isCurrentUser && (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                You
              </Badge>
            )}
          </div>
          {user.username && (
            <div className="truncate text-[13px] text-muted-foreground">
              @{user.displayUsername ?? user.username}
            </div>
          )}
        </div>
      </div>

      {user.status && (
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <p className="line-clamp-2 text-[13px] font-medium text-foreground/90">
            {user.status}
          </p>
        </div>
      )}

      {!isCurrentUser && (
        <div className="flex flex-col gap-3 border-t border-border/60 pt-3">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 w-full gap-2"
            disabled={isMutating}
            onClick={() => createDM.mutate()}
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
