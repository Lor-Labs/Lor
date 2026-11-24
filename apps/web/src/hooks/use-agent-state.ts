import type { ChannelActivity } from "@repo/realtime-types"
import type { CreatureState } from "@repo/utils/bestiary"
import { useQueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import type { WorkspaceAgent } from "@/hooks/use-agents"
import { workspaceActivityKey } from "@/hooks/use-workspace-activity"

// What an agent is doing across the channels it is in: waiting on someone in
// any of them, else working in any, else resting.
export function agentStateIn(
  // The snapshot's rows, or the sidebar's map of them by channel.
  activity:
    | Iterable<ChannelActivity>
    | Map<string, ChannelActivity>
    | undefined,
  agent: Pick<WorkspaceAgent, "channelIds"> | null
): CreatureState {
  const all = activity instanceof Map ? activity.values() : (activity ?? [])
  const rows = [...all].filter((row) =>
    agent?.channelIds.includes(row.channelId)
  )
  if (rows.some((row) => row.agentNeeds.length > 0)) return "needs_you"
  return rows.some((row) => row.agentWorking) ? "working" : "asleep"
}

// From the sidebar's activity snapshot, read without observing it, so this
// never changes how that query fetches.
export function useAgentState(
  workspaceId: string | undefined,
  agent: Pick<WorkspaceAgent, "channelIds"> | null
): CreatureState {
  const queryClient = useQueryClient()
  const key = workspaceActivityKey(workspaceId ?? "")
  const activity = useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => queryClient.getQueryData<ChannelActivity[]>(key)
  )
  return agentStateIn(activity, agent)
}
