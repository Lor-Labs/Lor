import type { ChannelActivity } from "@repo/realtime-types"
import { cn } from "@repo/ui/lib/utils"
import { createContext, type ReactNode, useContext, useMemo } from "react"
import { useWorkspaceActivity } from "@/hooks/use-workspace-activity"

const ActivityContext = createContext<{
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
  const value = useMemo(
    () => ({
      channels: new Map(
        activity?.map((channel) => [channel.channelId, channel])
      ),
    }),
    [activity]
  )
  return <ActivityContext value={value}>{children}</ActivityContext>
}

export function useChannelActivity(channelId: string) {
  const { channels } = useContext(ActivityContext)
  return channels.get(channelId)
}

const lorLabels = {
  working: "Lor is working",
  queued: "Lor is queued",
  needs_input: "Lor needs input",
  needs_approval: "Awaiting approval",
} as const

export function LorChannelStatus({
  state,
  compact = false,
}: {
  state: NonNullable<ChannelActivity["lor"]>
  compact?: boolean
}) {
  const working = state === "working"
  const waiting = state === "needs_input" || state === "needs_approval"
  return (
    <span
      title={lorLabels[state]}
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center gap-1.5 text-[11px] font-medium",
        waiting ? "text-warning-foreground" : "text-agent"
      )}
    >
      {working ? (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 rounded-full border-[1.5px] border-agent/20 border-t-agent motion-safe:animate-spin"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-3.5 shrink-0 items-center justify-center",
            waiting && "rounded-full bg-warning/12 text-[10px]"
          )}
        >
          {waiting ? (
            "!"
          ) : (
            <span className="size-1.5 rounded-full bg-current opacity-60" />
          )}
        </span>
      )}
      <span className={compact ? "sr-only" : "truncate"}>
        {lorLabels[state]}
      </span>
    </span>
  )
}
