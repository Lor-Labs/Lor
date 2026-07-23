import { Pin02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { useParams } from "@tanstack/react-router"
import { Hash } from "lucide-react"
import { ChannelMuteMenu } from "@/components/chat/channel-mute-menu"
import { HeaderSearch } from "@/components/chat/header-search"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { RightPanelToggle } from "@/components/sidebar/sidebar-toggle"

export type ChatContext =
  | { type: "channel"; name: string; topic?: string }
  | { type: "dm"; name: string; avatarUrl?: string }
  | { type: "group_dm"; name: string; memberCount: number }

export function ChatHeader({
  context,
  channelId,
  onTogglePinnedMessages,
}: {
  context: ChatContext
  channelId: string
  onTogglePinnedMessages?: () => void
}) {
  const { workspaceSlug } = useParams({ strict: false })

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <HeaderNavControls className="-ml-2" withDivider />
      {context.type === "channel" && (
        <Hash className="size-5 shrink-0 text-muted-foreground" />
      )}
      {context.type === "dm" && (
        <Avatar size="sm">
          {context.avatarUrl && (
            <AvatarImage src={context.avatarUrl} alt={context.name} />
          )}
          <AvatarFallback
            className="text-[10px] font-semibold"
            fallbackSeed={context.name}
          >
            {getAvatarInitials(context.name)}
          </AvatarFallback>
        </Avatar>
      )}
      <span className="font-semibold">{context.name}</span>
      {context.type === "channel" && context.topic && (
        <>
          <div className="mx-2 h-4 w-px bg-border" />
          <span className="truncate text-sm text-muted-foreground">
            {context.topic}
          </span>
        </>
      )}
      {context.type === "group_dm" && (
        <span className="text-sm text-muted-foreground">
          {context.memberCount} members
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <HeaderSearch
          mode={context.type === "channel" ? "workspace" : "dm"}
          channelId={channelId}
        />
        <ChannelMuteMenu channelId={channelId} />
        {context.type === "channel" && onTogglePinnedMessages && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onTogglePinnedMessages}
                aria-label="Toggle pinned messages"
                className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon icon={Pin02Icon} size={16} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Pinned Messages</TooltipContent>
          </Tooltip>
        )}
        {context.type === "channel" && (
          <RightPanelToggle
            workspaceSlug={workspaceSlug ?? ""}
            channelId={channelId}
          />
        )}
      </div>
    </div>
  )
}
