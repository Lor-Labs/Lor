import { Archive02Icon, HashtagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Button } from "@repo/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { Link } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { ThreadSubscribers } from "@/components/chat/thread-subscribers"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { SessionWorkSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { ThreadPanel } from "@/components/sidebar/right-panel/thread-panel"
import { RightPanelToggle } from "@/components/sidebar/sidebar-toggle"
import {
  type AgentSessionDetail,
  useAgentSession,
  useAgentSessionUpdates,
  useUpdateAgentSession,
} from "@/hooks/use-agent-session"
import { useChannelApprovals } from "@/hooks/use-approvals"
import { useChannelPeople } from "@/hooks/use-mention-candidates"
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

  useAgentSessionUpdates(session.id)
  const updateSession = useUpdateAgentSession(session.id)
  const people = useChannelPeople(workspaceSlug, session.channelId)
  const archivedBy = people.find(
    (person) => person.userId === session.archivedById
  )

  return (
    <ThreadPanel
      view={{
        type: "thread",
        workspaceSlug,
        channelId: session.channelId,
        threadRootId: session.threadRootId,
      }}
      sessionView={{
        header: ({ lorRunning }) => (
          <SessionHeader
            title={session.title}
            channelName={channel.name ?? "channel"}
            workView={workView}
            archived={session.archivedAt !== null}
            lorRunning={lorRunning}
            onRename={(title) => updateSession.mutate({ title })}
            onArchive={() => updateSession.mutate({ archived: true })}
          />
        ),
        archivedBar: session.archivedAt ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-foreground/[0.02] py-1.5 ps-3 pe-1.5 text-[13px] text-muted-foreground">
            <HugeiconsIcon
              icon={Archive02Icon}
              className="size-3.5 shrink-0"
              strokeWidth={2}
            />
            <span className="min-w-0 flex-1 truncate">
              Archived by {archivedBy?.name ?? "someone"}
            </span>
            <Button
              size="xs"
              variant="ghost"
              loading={updateSession.isPending}
              onClick={() => updateSession.mutate({ archived: false })}
            >
              Unarchive
            </Button>
          </div>
        ) : undefined,
      }}
    />
  )
}

function SessionHeader({
  title,
  channelName,
  workView,
  archived,
  lorRunning,
  onRename,
  onArchive,
}: {
  title: string
  channelName: string
  workView: SessionWorkSidebarView
  archived: boolean
  lorRunning: boolean
  onRename: (title: string) => void
  onArchive: () => void
}) {
  const { workspaceSlug, channelId } = workView
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())
  const [confirmArchive, setConfirmArchive] = useState(false)

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <HeaderNavControls className="-ml-2" withDivider />
      <SessionTitle title={title} readOnly={archived} onRename={onRename} />
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
        {!archived && (
          <TooltipTrigger
            handle={tooltipHandle}
            payload="Archive session"
            render={
              <button
                type="button"
                aria-label="Archive session"
                onClick={() =>
                  lorRunning ? setConfirmArchive(true) : onArchive()
                }
                className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              />
            }
          >
            <HugeiconsIcon
              icon={Archive02Icon}
              className="size-4"
              strokeWidth={2}
            />
          </TooltipTrigger>
        )}
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
      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this session?</AlertDialogTitle>
            <AlertDialogDescription>
              Lor is still working. Archiving stops it and closes the session
              for everyone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              onClick={() => {
                setConfirmArchive(false)
                onArchive()
              }}
            >
              Archive
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Click to rename, like a Linear issue title. Enter or leaving the field
// saves; Escape cancels.
function SessionTitle({
  title,
  readOnly,
  onRename,
}: {
  title: string
  readOnly: boolean
  onRename: (title: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editing = draft !== null
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  if (draft === null) {
    return (
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setDraft(title)}
        className="-ml-1.5 min-w-0 cursor-text truncate rounded-md px-1.5 py-0.5 text-left font-semibold transition-colors hover:bg-foreground/[0.06] disabled:cursor-default disabled:hover:bg-transparent"
      >
        {title}
      </button>
    )
  }

  const commit = () => {
    const next = draft.trim()
    setDraft(null)
    if (next && next !== title) onRename(next)
  }
  return (
    <input
      ref={inputRef}
      value={draft}
      maxLength={200}
      aria-label="Session title"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          commit()
        } else if (event.key === "Escape") {
          event.preventDefault()
          setDraft(null)
        }
      }}
      className="-ml-1.5 min-w-0 flex-1 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-semibold outline-none"
    />
  )
}
