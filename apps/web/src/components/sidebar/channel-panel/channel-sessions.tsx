import {
  Archive02Icon,
  ArrowDown01Icon,
  RepeatIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { SidebarSession } from "@repo/realtime-types"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { useNavigate, useParams } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { ArchiveSessionDialog } from "@/components/session/archive-session-dialog"
import {
  SessionStateIndicator,
  strongestSessionState,
  useActivityWorkspaceId,
} from "@/components/sidebar/channel-panel/channel-activity"
import { TypewriterText } from "@/components/ui/typewriter-text"
import { useMobileSidebar } from "@/context/mobile-sidebar-context"
import { useUpdateAgentSession } from "@/hooks/use-agent-session"

// Each channel lists at most this many of your sessions; a "N more" row
// expands the rest in place.
const SESSION_CAP = 3
const STATE_RANK = { needs_you: 0, running: 1, unread: 2, idle: 3 } as const
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

// The channel's icon doubles as the collapse toggle once it has sessions: it
// turns into a chevron only while the pointer is on the icon itself or it has
// keyboard focus, never on row hover.
export function SessionCollapseToggle({
  collapsed,
  onToggle,
  children,
}: {
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Show sessions" : "Hide sessions"}
      aria-expanded={!collapsed}
      className="group/toggle relative z-[1] flex size-4 shrink-0 cursor-pointer items-center justify-center outline-none"
    >
      <span className="flex transition-opacity group-hover/toggle:opacity-0 group-focus-visible/toggle:opacity-0">
        {children}
      </span>
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        className={cn(
          "absolute inset-0 size-4 opacity-0 transition-[opacity,transform] group-hover/toggle:opacity-70 group-focus-visible/toggle:opacity-70",
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

  // Attention first; the server already orders by newest activity.
  const ordered = useMemo(
    () =>
      [...sessions].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]),
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
              onArchive={() => {
                if (!workspaceId) return
                updateSession.mutate({
                  workspaceId,
                  channelId,
                  sessionId: session.id,
                  archived: true,
                })
              }}
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
// Codex's task list.
function SessionRow({
  session,
  onArchive,
}: {
  session: SidebarSession
  onArchive: () => void
}) {
  const navigate = useNavigate()
  const { workspaceSlug, sessionId } = useParams({ strict: false })
  const { setOpen: setMobileSidebarOpen } = useMobileSidebar()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const active = sessionId === session.id
  const emphasized = session.state === "unread" || session.state === "needs_you"

  return (
    <div className="group/session relative ml-6 w-[calc(100%-1.5rem)]">
      <button
        type="button"
        onClick={() => {
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
          active || emphasized ? "text-foreground" : "text-muted-foreground",
          active && "bg-foreground/[0.06] font-medium"
        )}
      >
        {session.loop && (
          <HugeiconsIcon
            icon={RepeatIcon}
            className="size-3.5 shrink-0 opacity-60"
            strokeWidth={2}
          />
        )}
        <span className="min-w-0 flex-1 truncate">
          <TypewriterText text={session.title} animate={!session.titleEdited} />
        </span>
        <span className="flex group-hover/session:hidden">
          <SessionStateIndicator state={session.state} />
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Archive session"
              onClick={() =>
                session.state === "running"
                  ? setConfirmArchive(true)
                  : onArchive()
              }
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
      <ArchiveSessionDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        onConfirm={onArchive}
      />
    </div>
  )
}
