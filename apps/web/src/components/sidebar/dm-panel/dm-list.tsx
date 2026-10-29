import type { UnreadNotification } from "@repo/realtime-types"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@repo/ui/components/avatar"
import { MentionBadge } from "@repo/ui/components/mention-badge"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useEffect } from "react"
import {
  sidebarRow,
  sidebarRowHover,
  sidebarRowMarkIn,
  sidebarRowSelected,
} from "@/components/sidebar/sidebar-menu-styles"
import { UserAvatar } from "@/components/ui/user-avatar"
import { useMobileSidebar } from "@/context/mobile-sidebar-context"
import { useSocket } from "@/context/socket-context"
import { useUnread } from "@/context/unread-context"
import { useNewIds } from "@/hooks/use-appended-ids"
import { apiClient } from "@/lib/api-client"
import type { DMember } from "@/lib/api-types"

export function DMList() {
  const navigate = useNavigate()
  const { dmId } = useParams({ strict: false })
  const { setOpen: closeMobileSidebar } = useMobileSidebar()

  const { data } = useQuery({
    queryKey: ["dms"],
    queryFn: async () => {
      const res = await apiClient.v1.dms.$get({ query: {} })
      if (!res.ok) throw new Error("Failed to fetch DMs")
      return res.json()
    },
  })

  // A new DM message for you (workspaceId null = a DM) refreshes the list, so
  // its preview and order stay current; your own sends patch it on send.
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    const onUnread = (payload: UnreadNotification) => {
      if (payload.workspaceId !== null) return
      void queryClient.invalidateQueries({ queryKey: ["dms"], exact: true })
    }
    socket.on("notification:unread", onUnread)
    return () => {
      socket.off("notification:unread", onUnread)
    }
  }, [socket, queryClient])
  const newDmIds = useNewIds(data?.data.map((dm) => dm.id) ?? [])

  if (!data || data.data.length === 0) {
    return (
      <div className="px-2 py-4 text-center text-sm text-muted-foreground">
        <p>No conversations yet.</p>
      </div>
    )
  }

  return (
    <nav className="space-y-0.5">
      {data.data.map((dm) => {
        const displayName =
          dm.type === "group_dm"
            ? (dm.name ?? dm.members.map((m) => m.name).join(", "))
            : (dm.members[0]?.name ?? "Unknown")

        return (
          <DMItem
            key={dm.id}
            channelId={dm.id}
            name={displayName}
            members={dm.members}
            lastMessage={dm.lastMessage?.content ?? null}
            lastMessageAuthor={dm.lastMessage?.author.name ?? null}
            isGroupDM={dm.type === "group_dm"}
            active={dmId === dm.id}
            arrived={newDmIds.has(dm.id)}
            onClick={() => {
              navigate({ to: "/dms/$dmId", params: { dmId: dm.id } })
              closeMobileSidebar(false)
            }}
          />
        )
      })}
    </nav>
  )
}

function GroupDMAvatars({ members }: { members: DMember[] }) {
  const shown = members.slice(0, 2)
  const overflow = members.length - shown.length

  return (
    <AvatarGroup className="shrink-0">
      {shown.map((m) => (
        <Avatar key={m.id} size="sm">
          {m.image && <AvatarImage src={m.image} alt={m.name ?? ""} />}
          <AvatarFallback fallbackSeed={m.name}>
            {getAvatarInitials(m.name)}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 && (
        <AvatarGroupCount className="text-[10px]">+{overflow}</AvatarGroupCount>
      )}
    </AvatarGroup>
  )
}

function DMItem({
  channelId,
  name,
  members,
  lastMessage,
  lastMessageAuthor,
  isGroupDM,
  active = false,
  arrived = false,
  onClick,
}: {
  channelId: string
  name: string
  members: DMember[]
  lastMessage: string | null
  lastMessageAuthor: string | null
  isGroupDM: boolean
  active?: boolean
  arrived?: boolean
  onClick?: () => void
}) {
  const { getUnreadCount, getMentionCount } = useUnread()
  const unreadCount = active ? 0 : getUnreadCount(channelId)
  const mentionCount = active ? 0 : getMentionCount(channelId)
  const hasUnread = unreadCount > 0

  const preview =
    isGroupDM && lastMessageAuthor && lastMessage
      ? `${lastMessageAuthor}: ${lastMessage}`
      : lastMessage

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        sidebarRow,
        arrived &&
          "fade-in-0 animate-in duration-300 motion-reduce:animate-none",
        "group relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5",
        active ? sidebarRowSelected : sidebarRowHover,
        active && "text-foreground",
        !active && hasUnread && "text-foreground",
        !active && !hasUnread && "text-muted-foreground"
      )}
    >
      {!active && hasUnread && (
        <div
          className={cn(
            sidebarRowMarkIn,
            "absolute inset-y-0 left-0 my-auto h-2 w-[3px] rounded-r-full bg-foreground"
          )}
        />
      )}
      {isGroupDM ? (
        <GroupDMAvatars members={members} />
      ) : (
        <UserAvatar name={members[0]?.name} src={members[0]?.image} size="sm" />
      )}
      <div className="min-w-0 flex-1 text-left">
        <div
          className={cn(
            "truncate text-[14px] leading-tight",
            hasUnread ? "font-semibold" : "font-medium"
          )}
        >
          {name}
        </div>
        {preview && (
          <div className="truncate text-[12px] leading-tight text-muted-foreground">
            {preview}
          </div>
        )}
      </div>
      <MentionBadge count={mentionCount} />
    </button>
  )
}
