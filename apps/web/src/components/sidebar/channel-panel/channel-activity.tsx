import type {
  ChannelActivity,
  SidebarSession,
  SidebarSessionState,
} from "@repo/realtime-types"
import { cn } from "@repo/ui/lib/utils"
import { createContext, type ReactNode, useContext, useMemo } from "react"
import { useWorkspaceSessionUpdates } from "@/hooks/use-agent-session"
import { useWorkspaceActivity } from "@/hooks/use-workspace-activity"

const ActivityContext = createContext<{
  workspaceId?: string
  channels: Map<string, ChannelActivity>
}>({ channels: new Map() })

export function ChannelActivityProvider({
  workspaceId,
  children,
}: {
  workspaceId?: string
  children: ReactNode
}) {
  const activity = useWorkspaceActivity(workspaceId)
  useWorkspaceSessionUpdates(workspaceId)
  const value = useMemo(
    () => ({
      workspaceId,
      channels: new Map(
        activity?.map((channel) => [channel.channelId, channel])
      ),
    }),
    [workspaceId, activity]
  )
  return <ActivityContext value={value}>{children}</ActivityContext>
}

export function useChannelActivity(channelId: string) {
  const { channels } = useContext(ActivityContext)
  return channels.get(channelId)
}

export function useActivityWorkspaceId() {
  return useContext(ActivityContext).workspaceId
}

const STATE_LABELS = {
  needs_you: "Needs you",
  running: "Lor is working",
  unread: "Unread",
} as const

// Strongest state among some sessions, for a collapsed channel row or the
// "N more" row: alert, then spinner, then dot.
export function strongestSessionState(
  sessions: SidebarSession[]
): SidebarSessionState | undefined {
  return (["needs_you", "running", "unread"] as const).find((state) =>
    sessions.some((session) => session.state === state)
  )
}

// A session's state in the sidebar: alert (needs you), spinner (running),
// blue dot (unread). Idle shows nothing.
export function SessionStateIndicator({
  state,
}: {
  state: SidebarSessionState
}) {
  if (state === "idle") return null
  const label = STATE_LABELS[state]
  if (state === "running") {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="size-3 shrink-0 rounded-full border-[1.5px] border-agent/20 border-t-agent motion-safe:animate-spin"
      />
    )
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "shrink-0",
        state === "unread"
          ? "mx-[3px] size-1.5 rounded-full bg-info"
          : "flex size-3.5 items-center justify-center rounded-full bg-warning/12 text-[10px] font-semibold text-warning-foreground"
      )}
    >
      {state === "needs_you" && "!"}
    </span>
  )
}
