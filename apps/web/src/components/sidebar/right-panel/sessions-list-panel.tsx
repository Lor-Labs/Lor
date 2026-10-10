import {
  Archive02Icon,
  ArchiveRestoreIcon,
  PencilEdit02Icon,
  RepeatIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { timeAgo } from "@repo/utils/date"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ArchiveSessionDialog } from "@/components/session/archive-session-dialog"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { SessionsListSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { useUpdateAgentSession } from "@/hooks/use-agent-session"
import {
  type ChannelSession,
  useChannelSessions,
} from "@/hooks/use-channel-sessions"
import { useOpenNewSession } from "@/hooks/use-open-new-session"
import { channelQueryOptions } from "@/lib/channel-query"

const FILTERS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
] as const

// Everyone's sessions in the channel, so teammates can browse and join each
// other's work. Opening one never subscribes you.
export function SessionsListPanel({ view }: { view: SessionsListSidebarView }) {
  const { setView } = useRightSidebar()
  const archived = view.filter === "archived"
  const { data: sessions, isPending } = useChannelSessions(
    view.channelId,
    archived
  )
  const openNewSession = useOpenNewSession()
  const { data: channel } = useQuery(
    channelQueryOptions(view.workspaceSlug, view.channelId)
  )

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title="Sessions"
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        actions={
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="New session"
                  onClick={openNewSession}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                />
              }
            >
              <HugeiconsIcon
                icon={PencilEdit02Icon}
                className="size-4"
                strokeWidth={2}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">New session</TooltipContent>
          </Tooltip>
        }
      />
      <div className="flex gap-1 px-3 pt-2.5 pb-1">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={view.filter === filter.value}
            onClick={() => setView({ ...view, filter: filter.value })}
            className="cursor-pointer rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-foreground/[0.06] aria-pressed:text-foreground"
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isPending && (
          <div className="p-4 text-center text-muted-foreground text-sm">
            Loading...
          </div>
        )}
        {sessions?.length === 0 && (
          <p className="p-8 text-center text-muted-foreground text-sm">
            {archived ? "No archived sessions" : "No sessions in this channel"}
          </p>
        )}
        {sessions?.map((session) => (
          <SessionListRow
            key={session.id}
            session={session}
            workspaceSlug={view.workspaceSlug}
            workspaceId={channel?.workspaceId ?? null}
            channelId={view.channelId}
          />
        ))}
      </div>
    </div>
  )
}

function SessionListRow({
  session,
  workspaceSlug,
  workspaceId,
  channelId,
}: {
  session: ChannelSession
  workspaceSlug: string
  workspaceId: string | null
  channelId: string
}) {
  const navigate = useNavigate()
  const updateSession = useUpdateAgentSession()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const archived = session.archivedAt !== null
  const setArchived = (next: boolean) => {
    if (!workspaceId) return
    updateSession.mutate({
      workspaceId,
      channelId,
      sessionId: session.id,
      archived: next,
    })
  }
  const byline = session.loop ? "Loop" : (session.creator?.name ?? "Lor")
  const when = timeAgo(
    archived ? (session.archivedAt ?? "") : session.lastActivityAt
  )

  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: "/$workspaceSlug/session/$sessionId",
            params: { workspaceSlug, sessionId: session.id },
          })
        }
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors group-hover/row:bg-foreground/[0.04] group-hover/row:pr-9"
      >
        {session.creator ? (
          <Avatar size="sm" className="size-5 shrink-0">
            {session.creator.image && (
              <AvatarImage
                src={session.creator.image}
                alt={session.creator.name}
              />
            )}
            <AvatarFallback
              avatarColor={session.creator.avatarColor}
              fallbackSeed={session.creator.name}
              className="text-[10px] font-semibold"
            >
              {session.creator.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ) : (
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
            <HugeiconsIcon
              icon={RepeatIcon}
              className="size-3.5"
              strokeWidth={2}
            />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-foreground">
            {session.title}
          </div>
          <div className="truncate text-muted-foreground text-xs">
            {byline} · {when}
          </div>
        </div>
        {session.running && (
          <span
            role="img"
            aria-label="Lor is working"
            className={cn(
              "size-3 shrink-0 rounded-full border-[1.5px] border-agent/20 border-t-agent motion-safe:animate-spin",
              "group-hover/row:hidden"
            )}
          />
        )}
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={archived ? "Unarchive session" : "Archive session"}
              onClick={() =>
                archived
                  ? setArchived(false)
                  : session.running
                    ? setConfirmArchive(true)
                    : setArchived(true)
              }
              className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
            />
          }
        >
          <HugeiconsIcon
            icon={archived ? ArchiveRestoreIcon : Archive02Icon}
            className="size-3.5"
            strokeWidth={2}
          />
        </TooltipTrigger>
        <TooltipContent side="left">
          {archived ? "Unarchive" : "Archive"}
        </TooltipContent>
      </Tooltip>
      <ArchiveSessionDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        onConfirm={() => setArchived(true)}
      />
    </div>
  )
}
