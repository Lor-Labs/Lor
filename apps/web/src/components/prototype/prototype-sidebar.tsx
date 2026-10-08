import {
  ArrowDown01Icon,
  HashtagIcon,
  PencilEdit02Icon,
  RepeatIcon,
  UnfoldMoreIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"
import { DesktopSidebarTitlebar } from "@/components/desktop-titlebar"
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar"
import {
  type Channel,
  channels,
  type Session,
  type SessionState,
} from "./prototype-data"

const ROLL_UP_ORDER: SessionState[] = ["needs_you", "running", "unread"]

export function SessionStateIndicator({ state }: { state: SessionState }) {
  if (state === "running") {
    return (
      <span
        title="Lor is working"
        className="size-3 shrink-0 rounded-full border-[1.5px] border-agent/20 border-t-agent motion-safe:animate-spin"
      />
    )
  }
  if (state === "unread") {
    return (
      <span
        title="Unread"
        className="mx-[3px] size-1.5 shrink-0 rounded-full bg-info"
      />
    )
  }
  if (state === "needs_you") {
    return (
      <span
        title="Needs you"
        className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-warning/12 text-[10px] font-semibold text-warning-foreground"
      >
        !
      </span>
    )
  }
  return null
}

export function PrototypeSidebar({
  sessions,
  activeChannelId,
  activeSessionId,
  newSessionActive,
  onSelectChannel,
  onSelectSession,
  onNewSession,
}: {
  sessions: Session[]
  activeChannelId: string | null
  activeSessionId: string | null
  newSessionActive: boolean
  onSelectChannel: (channelId: string) => void
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
}) {
  const [collapsed, setCollapsed] = useState(() => new Set(["product"]))

  const toggleChannel = (channelId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      return next
    })
  }

  return (
    <Sidebar variant="inset">
      <DesktopSidebarTitlebar />
      <SidebarHeader className="gap-1 p-0 pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="hover:bg-sidebar-accent">
              <WorkspaceAvatar
                name="Northstar"
                className="size-8 rounded-lg text-sm"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                Northstar
              </span>
              <HugeiconsIcon
                icon={UnfoldMoreIcon}
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-2 pt-2">
          <button
            type="button"
            onClick={onNewSession}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-[6px] text-[14px] transition-colors hover:bg-foreground/[0.06]",
              newSessionActive
                ? "bg-foreground/[0.06] font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <HugeiconsIcon
              icon={PencilEdit02Icon}
              className="size-4 shrink-0 opacity-70"
              strokeWidth={2}
            />
            New session
            <kbd className="ml-auto font-sans text-[11px] text-muted-foreground/70">
              ⌘N
            </kbd>
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 pb-2">
        <div className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
          Channels
        </div>
        {channels.map((channel) => {
          const channelSessions = sessions.filter(
            (session) => session.channelId === channel.id
          )
          const isCollapsed = collapsed.has(channel.id)
          const rollUp = ROLL_UP_ORDER.find((state) =>
            channelSessions.some((session) => session.state === state)
          )
          return (
            <div key={channel.id}>
              <ChannelRow
                channel={channel}
                active={activeChannelId === channel.id}
                hasSessions={channelSessions.length > 0}
                collapsed={isCollapsed}
                rollUp={isCollapsed ? rollUp : undefined}
                onSelect={() => onSelectChannel(channel.id)}
                onToggle={() => toggleChannel(channel.id)}
              />
              <AnimatePresence initial={false}>
                {!isCollapsed &&
                  channelSessions.map((session) => (
                    <motion.div
                      key={session.id}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: EASE_OUT }}
                      className="overflow-hidden"
                    >
                      <SessionRow
                        session={session}
                        active={activeSessionId === session.id}
                        onSelect={() => onSelectSession(session.id)}
                      />
                    </motion.div>
                  ))}
              </AnimatePresence>
            </div>
          )
        })}
      </SidebarContent>
    </Sidebar>
  )
}

function ChannelRow({
  channel,
  active,
  hasSessions,
  collapsed,
  rollUp,
  onSelect,
  onToggle,
}: {
  channel: Channel
  active: boolean
  hasSessions: boolean
  collapsed: boolean
  rollUp?: SessionState
  onSelect: () => void
  onToggle: () => void
}) {
  const icon = channel.type === "voice" ? VolumeHighIcon : HashtagIcon

  return (
    <div
      className={cn(
        "group/channel relative flex items-center gap-2 rounded-lg px-2 py-[6px] text-[14px] hover:bg-foreground/[0.06]",
        active
          ? "bg-foreground/[0.06] font-medium text-foreground"
          : "text-muted-foreground"
      )}
    >
      {active && (
        <div className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      {hasSessions ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Show sessions" : "Hide sessions"}
          className="relative size-4 shrink-0 cursor-pointer"
        >
          <HugeiconsIcon
            icon={icon}
            className="absolute inset-0 size-4 opacity-50 transition-opacity group-hover/channel:opacity-0"
            strokeWidth={2}
          />
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(
              "absolute inset-0 size-4 opacity-0 transition-[opacity,transform] group-hover/channel:opacity-70",
              collapsed && "-rotate-90"
            )}
            strokeWidth={2}
          />
        </button>
      ) : (
        <HugeiconsIcon
          icon={icon}
          className="size-4 shrink-0 opacity-50"
          strokeWidth={2}
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 cursor-pointer truncate text-left outline-none"
      >
        {channel.name}
      </button>
      {rollUp && <SessionStateIndicator state={rollUp} />}
    </div>
  )
}

function SessionRow({
  session,
  active,
  onSelect,
}: {
  session: Session
  active: boolean
  onSelect: () => void
}) {
  const emphasized = session.state === "unread" || session.state === "needs_you"
  const tone =
    active || emphasized ? "text-foreground" : "text-muted-foreground"

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "ml-6 flex w-[calc(100%-1.5rem)] cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] transition-colors hover:bg-foreground/[0.06]",
        tone,
        active && "bg-foreground/[0.06]"
      )}
    >
      {session.loop && (
        <HugeiconsIcon
          icon={RepeatIcon}
          className="size-3.5 shrink-0 opacity-60"
          strokeWidth={2}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{session.title}</span>
      <SessionStateIndicator state={session.state} />
    </button>
  )
}
