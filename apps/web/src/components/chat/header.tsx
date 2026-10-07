import { HashtagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
} from "@repo/ui/components/tooltip"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { useParams } from "@tanstack/react-router"
import { useState } from "react"
import { ChannelMuteMenu } from "@/components/chat/channel-mute-menu"
import { HeaderSearch } from "@/components/chat/header-search"
import { PinnedMessagesPopover } from "@/components/chat/pinned-messages-popover"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { RightPanelToggle } from "@/components/sidebar/sidebar-toggle"
import { PrivateHashIcon } from "@/components/ui/private-hash-icon"

export type ChatContext =
  | { type: "channel"; name: string; topic?: string; isPrivate?: boolean }
  | { type: "dm"; name: string; avatarUrl?: string }
  | { type: "group_dm"; name: string; memberCount: number }

export function ChatHeader({
  context,
  channelId,
}: {
  context: ChatContext
  channelId: string
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <HeaderNavControls className="-ml-2" withDivider />
      {context.type === "channel" &&
        (context.isPrivate ? (
          <PrivateHashIcon className="size-5 shrink-0 text-muted-foreground" />
        ) : (
          <HugeiconsIcon
            icon={HashtagIcon}
            className="size-5 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
        ))}
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
        <ChannelMuteMenu channelId={channelId} tooltipHandle={tooltipHandle} />
        {context.type === "channel" && workspaceSlug && (
          <PinnedMessagesPopover
            key={`${workspaceSlug}:${channelId}`}
            workspaceSlug={workspaceSlug}
            channelId={channelId}
            tooltipHandle={tooltipHandle}
          />
        )}
        {context.type === "channel" && (
          <RightPanelToggle
            workspaceSlug={workspaceSlug ?? ""}
            channelId={channelId}
            tooltipHandle={tooltipHandle}
          />
        )}
        <Tooltip handle={tooltipHandle}>
          {({ payload }) => <TooltipContent>{payload}</TooltipContent>}
        </Tooltip>
      </div>
    </div>
  )
}
