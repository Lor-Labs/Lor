import {
  Archive02Icon,
  ArrowDown01Icon,
  Link01Icon,
  MessageMultiple01Icon,
  PencilEdit02Icon,
  RepeatIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { SidebarSession } from "@repo/realtime-types"
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@repo/ui/components/context-menu"
import { useSidebar } from "@repo/ui/components/sidebar"
import { toast } from "@repo/ui/components/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { HintPopover } from "@/components/hints/hint-popover"
import { useHint } from "@/components/hints/hints-provider"
import { ArchiveSessionDialog } from "@/components/session/archive-session-dialog"
import {
  SessionStateIndicator,
  strongestSessionState,
  useActivityWorkspaceId,
} from "@/components/sidebar/channel-panel/channel-activity"
import { LineCounts } from "@/components/sidebar/right-panel/session-changes-panel"
import { TypewriterText } from "@/components/ui/typewriter-text"
import { useMobileSidebar } from "@/context/mobile-sidebar-context"
import {
  prefetchSession,
  useUpdateAgentSession,
} from "@/hooks/use-agent-session"
import { sessionTabLink } from "@/hooks/use-session-tabs"

// Each channel lists at most this many of your sessions; a "N more" row
// expands the rest in place.
const SESSION_CAP = 3
const COLLAPSED_KEY = "lor-collapsed-session-channels"

function readCollapsedIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"))
  } catch {
    return new Set()
  }
}

function storeCollapsed(channelId: string, collapsed: boolean) {
  const ids = readCollapsedIds()
  if (collapsed) ids.add(channelId)
  else ids.delete(channelId)
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]))
  } catch {}
}

// Whether a channel's session rows are hidden, remembered per device.
// Starting a session in a collapsed channel expands it.
export function useSessionCollapse(
  channelId: string,
  sessions: SidebarSession[] | undefined
) {
  const [collapsed, setCollapsed] = useState(() =>
    readCollapsedIds().has(channelId)
  )
  const knownIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!sessions) return
    const previous = knownIds.current
    knownIds.current = new Set(sessions.map((session) => session.id))
    if (previous && sessions.some((session) => !previous.has(session.id))) {
      storeCollapsed(channelId, false)
      setCollapsed(false)
    }
  }, [channelId, sessions])

  const toggle = () => {
    storeCollapsed(channelId, !collapsed)
    setCollapsed(!collapsed)
  }
  return { collapsed, toggle }
}

// The chevron at the end of a channel row with sessions: shows or hides them.
// Above the row's click overlay, so it toggles without opening the channel.
export function SessionCollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Show sessions" : "Hide sessions"}
      aria-expanded={!collapsed}
      className="relative z-[1] -mr-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/60 outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        className={cn(
          "size-3.5 transition-transform duration-150 ease-out",
          collapsed && "-rotate-90"
        )}
        strokeWidth={2}
      />
    </button>
  )
}

export function ChannelSessionRows({
  channelId,
  sessions,
  collapsed,
}: {
  channelId: string
  sessions: SidebarSession[]
  collapsed: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const workspaceId = useActivityWorkspaceId()
  const updateSession = useUpdateAgentSession()
  const navigate = useNavigate()
  const { workspaceSlug, sessionId: openSessionId } = useParams({
    strict: false,
  })
  const rename = (sessionId: string, title: string) => {
    if (!workspaceId) return
    updateSession.mutate({ workspaceId, channelId, sessionId, title })
  }
  const archive = (sessionId: string) => {
    if (!workspaceId) return
    updateSession.mutate({ workspaceId, channelId, sessionId, archived: true })
    // Archiving the session you're in leaves it for the channel's chat.
    if (sessionId === openSessionId && workspaceSlug) {
      void navigate({
        to: "/$workspaceSlug/$channelId",
        params: { workspaceSlug, channelId },
      })
    }
  }

  // Newest activity first, whatever the state (Jacob). Sorted here too, so
  // an optimistic row lands in place before the server's order arrives.
  const ordered = useMemo(
    () =>
      [...sessions].sort((a, b) =>
        b.lastActivityAt.localeCompare(a.lastActivityAt)
      ),
    [sessions]
  )
  const visible = collapsed
    ? []
    : expanded
      ? ordered
      : ordered.slice(0, SESSION_CAP)
  const hidden = expanded ? [] : ordered.slice(SESSION_CAP)

  return (
    <>
      <AnimatePresence initial={false}>
        {visible.map((session) => (
          <motion.div
            key={session.id}
            layout="position"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <SessionRow
              session={session}
              channelId={channelId}
              onRename={(title) => rename(session.id, title)}
              onArchive={() => archive(session.id)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
      {!collapsed && ordered.length > SESSION_CAP && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="ml-6 flex w-[calc(100%-1.5rem)] cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <span className="min-w-0 flex-1 truncate">
            {expanded ? "Show less" : `${hidden.length} more`}
          </span>
          {!expanded && <RollupIndicator sessions={hidden} />}
        </button>
      )}
    </>
  )
}

function RollupIndicator({ sessions }: { sessions: SidebarSession[] }) {
  const state = strongestSessionState(sessions)
  return state ? <SessionStateIndicator state={state} /> : null
}

// Hovering a row swaps its state indicator for an archive button, like
// Codex's task list. Right-click: rename (in place), copy link, archive.
function SessionRow({
  session,
  channelId,
  onRename,
  onArchive,
}: {
  session: SidebarSession
  channelId: string
  onRename: (title: string) => void
  onArchive: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { workspaceSlug, sessionId } = useParams({ strict: false })
  const prefetch = () => {
    if (!workspaceSlug) return
    prefetchSession(queryClient, workspaceSlug, {
      id: session.id,
      channelId,
      threadRootId: session.threadRootId,
    })
  }
  const { setOpen: setMobileSidebarOpen } = useMobileSidebar()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // Rename moves focus to its field, so the closing menu must not take it
  // back to the row.
  const renameChosen = useRef(false)
  const renameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) renameRef.current?.select()
  }, [renaming])
  const commitRename = () => {
    const next = renameRef.current?.value.trim() ?? ""
    setRenaming(false)
    if (next && next !== session.title) onRename(next)
  }
  const requestArchive = () =>
    session.state === "running" ? setConfirmArchive(true) : onArchive()
  const active = sessionId === session.id
  // The session you're reading is read, before the read marker round trip.
  const state = active && session.state === "unread" ? "idle" : session.state
  const emphasized = state === "unread" || state === "needs_you"
  const rowRef = useRef<HTMLDivElement>(null)
  const { isMobile, open: sidebarOpen, openMobile } = useSidebar()
  // Taught on the first session row a person sees, usually the one their
  // first @Lor just started.
  const sessionsHint = useHint(
    "sessions_intro",
    isMobile ? openMobile : sidebarOpen
  )

  const icon = (
    <HugeiconsIcon
      icon={
        session.loop
          ? RepeatIcon
          : session.code
            ? SourceCodeIcon
            : MessageMultiple01Icon
      }
      className="size-3.5 shrink-0 opacity-60"
      strokeWidth={2}
    />
  )

  return (
    <ContextMenu disabled={renaming} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger
        ref={rowRef}
        className="group/session relative ml-6 w-[calc(100%-1.5rem)]"
      >
        <HintPopover
          open={sessionsHint.show}
          anchor={rowRef}
          side="right"
          onDismiss={sessionsHint.dismiss}
        >
          Lor works in sessions, listed under their channel. Anyone in the
          channel can open one and join in.
        </HintPopover>
        {renaming ? (
          <div className="flex w-full items-center gap-2 rounded-md bg-foreground/[0.06] px-2 py-[5px] text-[13px]">
            {icon}
            <input
              ref={renameRef}
              defaultValue={session.title}
              maxLength={200}
              aria-label="Session title"
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  commitRename()
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  setRenaming(false)
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
            />
          </div>
        ) : (
          <>
            <button
              type="button"
              onPointerEnter={prefetch}
              onFocus={prefetch}
              onClick={() => {
                sessionsHint.dismiss()
                prefetch()
                if (!workspaceSlug) return
                void navigate({
                  to: "/$workspaceSlug/session/$sessionId",
                  params: { workspaceSlug, sessionId: session.id },
                })
                setMobileSidebarOpen(false)
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] transition-colors group-hover/session:bg-foreground/[0.06] group-hover/session:pr-7",
                active || emphasized
                  ? "text-foreground"
                  : "text-muted-foreground",
                (active || menuOpen) && "bg-foreground/[0.06]",
                active && "font-medium"
              )}
            >
              {icon}
              <span className="min-w-0 flex-1 truncate">
                <TypewriterText
                  text={session.title}
                  animate={!session.titleEdited}
                />
              </span>
              <span className="flex items-center gap-2 group-hover/session:hidden">
                {session.uncommitted && (
                  <LineCounts
                    {...session.uncommitted}
                    className="gap-1 font-normal text-[11px]"
                  />
                )}
                <SessionStateIndicator state={state} />
              </span>
            </button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Archive session"
                    onClick={requestArchive}
                    className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/session:opacity-100"
                  />
                }
              >
                <HugeiconsIcon
                  icon={Archive02Icon}
                  className="size-3.5"
                  strokeWidth={2}
                />
              </TooltipTrigger>
              <TooltipContent side="right">Archive</TooltipContent>
            </Tooltip>
          </>
        )}
      </ContextMenuTrigger>
      <ContextMenuPopup
        align="start"
        finalFocus={() => {
          const keep = !renameChosen.current
          renameChosen.current = false
          return keep
        }}
      >
        <ContextMenuItem
          onClick={() => {
            renameChosen.current = true
            setRenaming(true)
          }}
        >
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            if (!workspaceSlug) return
            void navigator.clipboard
              .writeText(sessionTabLink(workspaceSlug, session.id, null))
              .then(() => toast.success("Link copied"))
          }}
        >
          <HugeiconsIcon icon={Link01Icon} strokeWidth={2} />
          Copy link
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={requestArchive}>
          <HugeiconsIcon icon={Archive02Icon} strokeWidth={2} />
          Archive
        </ContextMenuItem>
      </ContextMenuPopup>
      {/* Outside the trigger: a right-click in the dialog must not open the
          row's menu. */}
      <ArchiveSessionDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        onConfirm={onArchive}
      />
    </ContextMenu>
  )
}
