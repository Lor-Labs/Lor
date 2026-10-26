import {
  Archive02Icon,
  GitBranchIcon,
  HashtagIcon,
  Link01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import type { RealtimeAgentSession } from "@repo/realtime-types"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { toast } from "@repo/ui/components/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
} from "@repo/ui/components/tooltip"
import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { timeAgo } from "@repo/utils/date"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { ThreadSubscribers } from "@/components/chat/thread-subscribers"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { ArchiveSessionDialog } from "@/components/session/archive-session-dialog"
import { SessionDocument } from "@/components/session/session-document"
import {
  SessionTabBar,
  SessionTabView,
} from "@/components/session/session-tabs"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { SessionWorkSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { RightPanelToggle } from "@/components/sidebar/sidebar-toggle"
import { TypewriterText } from "@/components/ui/typewriter-text"
import {
  type AgentSessionDetail,
  prefetchSession,
  useAgentSession,
  useAgentSessionUpdates,
  useForkSession,
  useRewindSession,
  useUpdateAgentSession,
} from "@/hooks/use-agent-session"
import { useChannelApprovals } from "@/hooks/use-approvals"
import { useChannelPeople } from "@/hooks/use-mention-candidates"
import { useChannelProposals } from "@/hooks/use-proposals"
import { useLiveSessionChanges } from "@/hooks/use-session-changes"
import {
  parseTabId,
  sessionTabLink,
  useSessionTabs,
} from "@/hooks/use-session-tabs"
import {
  findSidebarSession,
  patchSidebarSession,
} from "@/hooks/use-workspace-activity"
import { clearLastSessionId, writeLastSession } from "@/lib/last-location"

export function SessionView({
  workspaceSlug,
  sessionId,
  targetMessageId,
}: {
  workspaceSlug: string
  sessionId: string
  targetMessageId?: string
}) {
  const { data, isPending, isError } = useAgentSession(sessionId)
  // Opened without a row hover (⌘K, a link, a notification): the sidebar row
  // knows the thread, so the transcript loads alongside the session.
  const queryClient = useQueryClient()
  useEffect(() => {
    const listed = findSidebarSession(queryClient, sessionId)
    if (!listed) return
    prefetchSession(queryClient, workspaceSlug, {
      id: sessionId,
      channelId: listed.channelId,
      threadRootId: listed.session.threadRootId,
    })
  }, [queryClient, sessionId, workspaceSlug])
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
      targetMessageId={targetMessageId}
    />
  )
}

function SessionConversation({
  workspaceSlug,
  detail: { session, channel, source },
  targetMessageId,
}: {
  workspaceSlug: string
  detail: AgentSessionDetail
  targetMessageId?: string
}) {
  // Approval and proposal cards render inline in the session; keep them live.
  useChannelApprovals(session.channelId, session.threadRootId)
  useChannelProposals(session.channelId)
  const queryClient = useQueryClient()
  useEffect(() => {
    writeLastSession(workspaceSlug, session.id, session.channelId)
    // Opening it reads it: the sidebar's unread state clears now, not after
    // the read marker round trip.
    patchSidebarSession(
      queryClient,
      {
        workspaceId: session.workspaceId,
        channelId: session.channelId,
        sessionId: session.id,
      },
      { state: "idle", from: "unread" }
    )
  }, [
    workspaceSlug,
    session.id,
    session.channelId,
    session.workspaceId,
    queryClient,
  ])

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

  // Code sessions: files and diffs open in tabs beside the chat.
  const code = session.mode === "code"
  useLiveSessionChanges(session.id, session.threadRootId, code)
  const tabs = useSessionTabs(session.id)
  const activeTab = code && tabs.active ? parseTabId(tabs.active) : null
  const showTabs = code && (tabs.ids.length > 0 || activeTab !== null)

  useAgentSessionUpdates(session.id)
  const updateSession = useUpdateAgentSession()
  const fork = useForkSession(workspaceSlug)
  const rewind = useRewindSession(session.id)
  const navigate = useNavigate()
  const change = {
    workspaceId: session.workspaceId,
    channelId: session.channelId,
    sessionId: session.id,
  }
  const { data: auth } = authClient.useSession()
  const people = useChannelPeople(workspaceSlug, session.channelId)
  const nameOf = (userId: string | null) =>
    userId === auth?.user.id
      ? "you"
      : (people.find((person) => person.userId === userId)?.name ?? "someone")
  const archivedBy = nameOf(session.archivedById)
  const startedBy =
    session.origin === "loop"
      ? "Loop"
      : session.origin === "trigger"
        ? "Started by an automation"
        : `Started by ${nameOf(session.creatorId)}`
  const starter =
    people.find((person) => person.userId === session.creatorId) ?? null
  const [renaming, setRenaming] = useState(false)

  return (
    <SessionDocument
      workspaceSlug={workspaceSlug}
      channelId={session.channelId}
      threadRootId={session.threadRootId}
      targetMessageId={targetMessageId}
      onFork={(message) =>
        fork.mutateAsync({ sessionId: session.id, messageId: message.id })
      }
      onRewind={
        session.archivedAt
          ? undefined
          : (message) => rewind.mutateAsync(message.id)
      }
      rewindRestoresFiles={code}
      header={({ lorRunning, headingVisible }) => (
        <SessionStrip
          session={session}
          workView={workView}
          lorRunning={lorRunning}
          showTitle={!headingVisible}
          tabBar={
            showTabs ? (
              <SessionTabBar
                workspaceSlug={workspaceSlug}
                sessionId={session.id}
                tabs={tabs}
              />
            ) : null
          }
          onRename={() => setRenaming(true)}
          onArchive={() => {
            updateSession.mutate({ ...change, archived: true })
            // Nothing left to do here; back to the channel's chat.
            void navigate({
              to: "/$workspaceSlug/$channelId",
              params: { workspaceSlug, channelId: session.channelId },
            })
          }}
        />
      )}
      heading={
        <SessionHeading
          session={session}
          channelName={channel.name ?? "channel"}
          source={source}
          startedBy={startedBy}
          starter={starter}
          renaming={renaming}
          onRenamingChange={setRenaming}
          onRename={(title) => updateSession.mutate({ ...change, title })}
        />
      }
      cover={
        activeTab ? (
          <SessionTabView
            key={activeTab.id}
            sessionId={session.id}
            tab={activeTab}
            onOpen={tabs.open}
          />
        ) : undefined
      }
      archivedBar={
        session.archivedAt ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-foreground/[0.02] py-1.5 ps-3 pe-1.5 text-[13px] text-muted-foreground">
            <HugeiconsIcon
              icon={Archive02Icon}
              className="size-3.5 shrink-0"
              strokeWidth={2}
            />
            <span className="min-w-0 flex-1 truncate">
              Archived by {archivedBy}
            </span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                updateSession.mutate({ ...change, archived: false })
              }
            >
              Unarchive
            </Button>
          </div>
        ) : undefined
      }
    />
  )
}

// A slim icon strip: the title opens the document instead (SessionHeading),
// and fades in here once the heading scrolls away, like the phone's bar.
function SessionStrip({
  session,
  workView,
  lorRunning,
  showTitle,
  tabBar,
  onRename,
  onArchive,
}: {
  session: RealtimeAgentSession
  workView: SessionWorkSidebarView
  lorRunning: boolean
  showTitle: boolean
  // A code session's open tabs take the title's place.
  tabBar: ReactNode
  onRename: () => void
  onArchive: () => void
}) {
  const { workspaceSlug, channelId } = workView
  const navigate = useNavigate()
  const archived = session.archivedAt !== null
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())
  const [confirmArchive, setConfirmArchive] = useState(false)
  // The session itself, without an open tab or highlighted message.
  const copyLink = () =>
    void navigator.clipboard
      .writeText(sessionTabLink(workspaceSlug, session.id, null))
      .then(() => toast.success("Link copied"))

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 px-3">
      <HeaderNavControls className="-ml-1" />
      {tabBar}
      <AnimatePresence initial={false}>
        {showTitle && !tabBar && (
          <motion.span
            key="title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: EASE_OUT }}
            className="min-w-0 truncate px-1 text-[13px] font-medium"
          >
            {session.title}
          </motion.span>
        )}
      </AnimatePresence>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <ThreadSubscribers
          workspaceSlug={workspaceSlug}
          channelId={channelId}
          threadRootId={workView.threadRootId}
          session={session}
          facesOnly
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Session actions"
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
            {!archived && (
              <DropdownMenuItem onClick={onRename}>
                <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                Rename
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() =>
                void navigate({
                  to: "/$workspaceSlug/session/new",
                  params: { workspaceSlug },
                  search: {
                    channelId: session.channelId,
                    continueFrom: session.id,
                  },
                })
              }
            >
              <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} />
              Continue in Code
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyLink}>
              <HugeiconsIcon icon={Link01Icon} strokeWidth={2} />
              Copy link
            </DropdownMenuItem>
            {!archived && (
              <DropdownMenuItem
                onClick={() =>
                  lorRunning ? setConfirmArchive(true) : onArchive()
                }
              >
                <HugeiconsIcon icon={Archive02Icon} strokeWidth={2} />
                Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
      <ArchiveSessionDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        onConfirm={onArchive}
      />
    </div>
  )
}

// The document's opening: the title, then one quiet line of context.
function SessionHeading({
  session,
  channelName,
  source,
  startedBy,
  starter,
  renaming,
  onRenamingChange,
  onRename,
}: {
  session: RealtimeAgentSession
  channelName: string
  // "Continue in Code" or a fork: the session this one comes from.
  source: { id: string; title: string } | null
  startedBy: string
  // The person who started it; null for loops and automations.
  starter: {
    name: string
    image: string | null
    avatarColor: string | null
  } | null
  renaming: boolean
  onRenamingChange: (renaming: boolean) => void
  onRename: (title: string) => void
}) {
  const { workspaceSlug } = useParams({ strict: false })
  return (
    <div>
      <SessionTitle
        title={session.title}
        generated={session.titleEditedAt === null}
        readOnly={session.archivedAt !== null}
        editing={renaming}
        onEditingChange={onRenamingChange}
        onRename={onRename}
      />
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-sm">
        {workspaceSlug ? (
          <Link
            to="/$workspaceSlug/$channelId"
            params={{ workspaceSlug, channelId: session.channelId }}
            className="inline-flex items-center gap-0.5 transition-colors hover:text-foreground"
          >
            <HugeiconsIcon
              icon={HashtagIcon}
              className="size-3.5"
              strokeWidth={2}
            />
            {channelName}
          </Link>
        ) : null}
        {source && workspaceSlug && (
          <>
            <span aria-hidden="true">·</span>
            <Link
              to="/$workspaceSlug/session/$sessionId"
              params={{ workspaceSlug, sessionId: source.id }}
              // A fork opens its source at the reply it was forked from.
              search={
                session.forkedFromMessageId
                  ? { msgId: session.forkedFromMessageId }
                  : {}
              }
              className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-foreground"
            >
              {session.forkedFromMessageId ? "Forked from" : "Continued from"}
              <span className="max-w-64 truncate font-medium">
                {source.title}
              </span>
            </Link>
          </>
        )}
        {session.repoFullName && session.baseBranch && (
          <>
            <span aria-hidden="true">·</span>
            <a
              href={`https://github.com/${session.repoFullName}/tree/${session.baseBranch}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              <HugeiconsIcon
                icon={SourceCodeIcon}
                className="size-3.5"
                strokeWidth={2}
              />
              {session.repoFullName}
              <HugeiconsIcon
                icon={GitBranchIcon}
                className="ml-1 size-3.5"
                strokeWidth={2}
              />
              {session.baseBranch}
            </a>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1.5">
          {starter && (
            <Avatar className="size-4">
              {starter.image && (
                <AvatarImage src={starter.image} alt={starter.name} />
              )}
              <AvatarFallback
                avatarColor={starter.avatarColor}
                fallbackSeed={starter.name}
                className="font-semibold text-[8px]"
              >
                {getAvatarInitials(starter.name)}
              </AvatarFallback>
            </Avatar>
          )}
          {startedBy}
        </span>
        <span aria-hidden="true">·</span>
        <span>{timeAgo(session.createdAt)}</span>
      </p>
      <div className="mt-6 border-border/50 border-t" />
    </div>
  )
}

// Click to rename, like a Linear issue title (or Rename in the strip's menu).
// Enter or leaving the field saves; Escape cancels.
function SessionTitle({
  title,
  generated,
  readOnly,
  editing,
  onEditingChange,
  onRename,
}: {
  title: string
  // Lor's title types out; a person's rename shows at once.
  generated: boolean
  readOnly: boolean
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onRename: (title: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])
  const heading = "font-semibold text-[26px] leading-tight tracking-tight"

  if (!editing || readOnly) {
    return (
      <button
        type="button"
        disabled={readOnly}
        onClick={() => onEditingChange(true)}
        className={cn(
          heading,
          "-ml-1.5 block max-w-full cursor-text rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-foreground/[0.06] disabled:cursor-default disabled:hover:bg-transparent"
        )}
      >
        <TypewriterText text={title} animate={generated} />
      </button>
    )
  }

  const commit = () => {
    const next = inputRef.current?.value.trim() ?? ""
    onEditingChange(false)
    if (next && next !== title) onRename(next)
  }
  return (
    <input
      ref={inputRef}
      defaultValue={title}
      maxLength={200}
      aria-label="Session title"
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          commit()
        } else if (event.key === "Escape") {
          event.preventDefault()
          onEditingChange(false)
        }
      }}
      className={cn(
        heading,
        "-ml-1.5 w-full rounded-md bg-foreground/[0.06] px-1.5 py-0.5 outline-none"
      )}
    />
  )
}
