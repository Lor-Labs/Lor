import { Pin02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"

import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatTime } from "@repo/utils/date"
import { useQuery } from "@tanstack/react-query"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import type { PinnedMessagesSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { apiClient } from "@/lib/api-client"

export function PinnedMessagesPanel({
  view,
}: {
  view: PinnedMessagesSidebarView
}) {
  const { data, isPending } = useQuery({
    queryKey: ["pinned-messages", view.channelId],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].pins.$get({
        param: { workspaceSlug: view.workspaceSlug, channelId: view.channelId },
      })
      if (!res.ok) throw new Error("Failed to fetch pinned messages")
      return res.json()
    },
  })

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title="Pinned messages"
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
      />
      <div className="flex-1 overflow-y-auto">
        {isPending && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Loading...
          </div>
        )}
        {data && data.data.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <HugeiconsIcon
              icon={Pin02Icon}
              size={32}
              className="text-muted-foreground/40"
            />
            <p className="text-sm text-muted-foreground">
              No pinned messages yet
            </p>
          </div>
        )}
        {data?.data.map((msg) => (
          <div
            key={msg.id}
            className="rounded-lg px-4 py-3 transition-colors hover:bg-foreground/[0.04]"
          >
            <div className="flex items-center gap-2">
              <Avatar size="sm">
                {msg.author.image && (
                  <AvatarImage src={msg.author.image} alt={msg.author.name} />
                )}
                <AvatarFallback
                  avatarColor={msg.author.avatarColor}
                  className="text-[9px] font-semibold"
                  fallbackSeed={msg.author.name}
                >
                  {getAvatarInitials(msg.author.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs font-semibold">
                {msg.author.displayUsername ?? msg.author.name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {formatTime(msg.createdAt)}
              </span>
            </div>
            <div className="mt-1 pl-7 text-sm">
              <MessageMarkdown content={msg.content} mentions={msg.mentions} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
