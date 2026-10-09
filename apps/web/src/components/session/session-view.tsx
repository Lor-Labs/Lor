import { HashtagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
} from "@repo/ui/components/tooltip"
import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { Link } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { ThreadSubscribers } from "@/components/chat/thread-subscribers"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { SessionWorkSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { ThreadPanel } from "@/components/sidebar/right-panel/thread-panel"
import { RightPanelToggle } from "@/components/sidebar/sidebar-toggle"
import {
  type AgentSessionDetail,
  useAgentSession,
} from "@/hooks/use-agent-session"
import { useChannelApprovals } from "@/hooks/use-approvals"
import { useChannelProposals } from "@/hooks/use-proposals"
import { clearLastSessionId, writeLastSession } from "@/lib/last-location"

export function SessionView({
  workspaceSlug,
  sessionId,
}: {
  workspaceSlug: string
  sessionId: string
}) {
  const { data, isPending, isError } = useAgentSession(sessionId)
  // A remembered session that no longer opens must not be the landing page.
  useEffect(() => {
    if (isError) clearLastSessionId(workspaceSlug)
  }, [isError, workspaceSlug])

  if (isPending || isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">
          {isPending ? "Loading..." : "Session not found"}
        </span>
      </div>
    )
  }

  return (
    <SessionConversation
      key={data.session.id}
      workspaceSlug={workspaceSlug}
      detail={data}
    />
  )
}

function SessionConversation({
  workspaceSlug,
  detail: { session, channel },
}: {
  workspaceSlug: string
  detail: AgentSessionDetail
}) {
  // Approval and proposal cards render inline in the session; keep them live
  // here, since the channel page that also mounts these may not be open.
  useChannelApprovals(session.channelId)
  useChannelProposals(session.channelId)
  useEffect(() => {
    writeLastSession(workspaceSlug, session.id, session.channelId)
  }, [workspaceSlug, session.id, session.channelId])

  // The right panel shows this session's context, plan, files and activity
  // while the page is open, the way a channel page sets its own panel view.
  const { setView, clearView } = useRightSidebar()
  const isMobile = useIsMobile()
  const workView = useMemo<SessionWorkSidebarView>(
    () => ({
      type: "session-work",
      workspaceSlug,
      channelId: session.channelId,
      sessionId: session.id,
      threadRootId: session.threadRootId,
    }),
    [workspaceSlug, session.channelId, session.id, session.threadRootId]
  )
  useEffect(() => {
    if (isMobile !== false) return
    setView(workView)
    return () => clearView()
  }, [workView, isMobile, setView, clearView])

  return (
    <ThreadPanel
      view={{
        type: "thread",
        workspaceSlug,
        channelId: session.channelId,
        threadRootId: session.threadRootId,
      }}
      sessionView={{
        header: (
          <SessionHeader
            title={session.title}
            channelName={channel.name ?? "channel"}
            workView={workView}
          />
        ),
      }}
    />
  )
}

function SessionHeader({
  title,
  channelName,
  workView,
}: {
  title: string
  channelName: string
  workView: SessionWorkSidebarView
}) {
  const { workspaceSlug, channelId } = workView
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <HeaderNavControls className="-ml-2" withDivider />
      <span className="truncate font-semibold">{title}</span>
      <Link
        to="/$workspaceSlug/$channelId"
        params={{ workspaceSlug, channelId }}
        className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <HugeiconsIcon
          icon={HashtagIcon}
          className="size-3.5"
          strokeWidth={2}
        />
        {channelName}
      </Link>
      <div className="ml-auto flex items-center gap-1">
        <ThreadSubscribers
          workspaceSlug={workspaceSlug}
          channelId={channelId}
          threadRootId={workView.threadRootId}
        />
        <RightPanelToggle
          workspaceSlug={workspaceSlug}
          channelId={channelId}
          openView={workView}
          tooltipHandle={tooltipHandle}
        />
        <Tooltip handle={tooltipHandle}>
          {({ payload }) => <TooltipContent>{payload}</TooltipContent>}
        </Tooltip>
      </div>
    </div>
  )
}
