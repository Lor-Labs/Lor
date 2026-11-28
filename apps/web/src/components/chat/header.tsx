import {
  MoreHorizontalIcon,
  SquareLock02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { useSidebar } from "@repo/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
} from "@repo/ui/components/tooltip"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useState } from "react"
import { ChannelMuteMenu } from "@/components/chat/channel-mute-menu"
import { PinnedMessagesPopover } from "@/components/chat/pinned-messages-popover"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { ChatAvatar } from "@/components/sidebar/chat-panel/chat-avatar"
import { chatPeopleQueryOptions } from "@/components/sidebar/right-panel/chat-details-panel"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { RightPanelToggle } from "@/components/sidebar/sidebar-toggle"
import { useAgentsById } from "@/hooks/use-agents"
import { useOpenChannelSessions } from "@/hooks/use-open-channel-sessions"
import { channelQueryOptions } from "@/lib/channel-query"

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
  const openChannelSessions = useOpenChannelSessions()

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <HeaderNavControls className="-ml-2" withDivider />
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
      {context.type === "channel" && workspaceSlug ? (
        <ChatTitle
          workspaceSlug={workspaceSlug}
          channelId={channelId}
          name={context.name}
          isPrivate={context.isPrivate}
        />
      ) : (
        <span className="font-semibold">{context.name}</span>
      )}
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
        {context.type === "channel" && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Chat actions"
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground data-popup-open:bg-foreground/5 data-popup-open:text-foreground"
                />
              }
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                className="size-4"
                strokeWidth={2}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              <DropdownMenuItem onClick={() => openChannelSessions(channelId)}>
                View Sessions
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Tooltip handle={tooltipHandle}>
          {({ payload }) => <TooltipContent>{payload}</TooltipContent>}
        </Tooltip>
      </div>
    </div>
  )
}

// A chat's face and name. Who is in it is in the details panel beside it:
// pressing this opens that panel, or puts it away.
function ChatTitle({
  workspaceSlug,
  channelId,
  name,
  isPrivate,
}: {
  workspaceSlug: string
  channelId: string
  name: string
  isPrivate?: boolean
}) {
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const agentsById = useAgentsById(workspaceSlug)
  const { data: chat } = useQuery(channelQueryOptions(workspaceSlug, channelId))
  const { data: people } = useQuery({
    ...chatPeopleQueryOptions(workspaceSlug, channelId),
    // Only a chat has people of its own.
    enabled: chat?.type === "text",
  })
  const { view, openView, clearView, isCollapsed, toggleCollapsed } =
    useRightSidebar()
  const isMobile = useSidebar().isMobile
  const shown = view?.type === "workspace-members"
  const open = shown && (isMobile || !isCollapsed)
  const toggle = () => {
    if (open) return isMobile ? clearView() : toggleCollapsed()
    openView({ type: "workspace-members", workspaceSlug, channelId })
  }

  const agents = (chat?.agentIds ?? []).flatMap(
    (id) => agentsById.get(id) ?? []
  )
  const others = (people ?? []).filter((person) => person.id !== me)
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      title="Chat details"
      className="-ml-1 flex min-w-0 cursor-pointer items-center gap-2 rounded-lg py-1 pr-2.5 pl-1 outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98] aria-expanded:bg-foreground/[0.05] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <ChatAvatar
        agents={agents}
        // Nobody else and no agent: the chat wears your own face.
        people={others.length + agents.length > 0 ? others : (people ?? [])}
        total={agents.length + others.length}
        size={28}
      />
      <span className="truncate font-semibold">{name}</span>
      {isPrivate && (
        <HugeiconsIcon
          icon={SquareLock02Icon}
          aria-label="Private"
          className="size-3.5 shrink-0 text-muted-foreground"
          strokeWidth={2}
        />
      )}
    </button>
  )
}
