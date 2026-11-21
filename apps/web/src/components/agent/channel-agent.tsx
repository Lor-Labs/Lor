import { LOR_USER_ID } from "@repo/db/constants"
import type {
  ChannelActivity,
  TypingIndicatorEvent,
} from "@repo/realtime-types"
import {
  type CreatureId,
  type CreatureState,
  channelAgentIdentity,
} from "@repo/utils/bestiary"
import { useQuery } from "@tanstack/react-query"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useSocket } from "@/context/socket-context"
import { workspaceActivityKey } from "@/hooks/use-workspace-activity"
import { channelQueryOptions } from "@/lib/channel-query"

export type ChannelAgent = {
  channelId: string
  name: string
  creature: CreatureId
  state: CreatureState
}

const WORKING_FOR_MS = 15_000

// Working while a turn runs: the worker beats "agent:working" every 10s
// (showWorking), and typing counts too.
function useAgentWorking(channelId: string) {
  const socket = useSocket()
  const [until, setUntil] = useState(0)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!socket) return
    const onTyping = (payload: TypingIndicatorEvent) => {
      if (payload.channelId !== channelId || payload.userId !== LOR_USER_ID)
        return
      setUntil(Date.now() + WORKING_FOR_MS)
    }
    const onWorking = (payload: { channelId: string; working: boolean }) => {
      if (payload.channelId !== channelId) return
      setUntil(payload.working ? Date.now() + WORKING_FOR_MS : 0)
    }
    socket.on("typing:update", onTyping)
    socket.on("agent:working", onWorking)
    return () => {
      socket.off("typing:update", onTyping)
      socket.off("agent:working", onWorking)
    }
  }, [socket, channelId])
  const working = until > Date.now()
  useEffect(() => {
    if (!working) return
    const timer = setTimeout(
      () => setTick((tick) => tick + 1),
      until - Date.now() + 50
    )
    return () => clearTimeout(timer)
  }, [working, until])
  return working
}

// A text channel's agent: the name and creature the team picked (or the
// derived ones), and what it is doing now (reference/always-on-agents.md,
// decisions 32 and 33). Null for other channel types.
export function useChannelAgent(
  workspaceSlug: string | undefined,
  channelId: string
): ChannelAgent | null {
  const { data: channel } = useQuery({
    ...channelQueryOptions(workspaceSlug ?? "", channelId),
    enabled: Boolean(workspaceSlug && channelId),
  })
  // Read from the sidebar's snapshot; this hook never fetches it.
  const { data: activity } = useQuery<ChannelActivity[]>({
    queryKey: workspaceActivityKey(channel?.workspaceId ?? ""),
    queryFn: () => Promise.reject(new Error("Read only")),
    enabled: false,
  })
  const working = useAgentWorking(channelId)
  const needsYou = Boolean(
    activity?.find((row) => row.channelId === channelId)?.agentNeeds.length
  )
  return useMemo(() => {
    if (!channel || channel.type !== "text") return null
    const identity = channelAgentIdentity(channel)
    return {
      channelId,
      ...identity,
      state: needsYou ? "needs_you" : working ? "working" : "asleep",
    }
  }, [channel, channelId, needsYou, working])
}

const ChannelAgentContext = createContext<ChannelAgent | null>(null)

// Lor's messages under this provider are the channel agent's: its name and
// creature replace Lor's. Session views have none, so Lor stays Lor there.
export function ChannelAgentProvider({
  workspaceSlug,
  channelId,
  children,
}: {
  workspaceSlug: string | undefined
  channelId: string
  children: ReactNode
}) {
  const agent = useChannelAgent(workspaceSlug, channelId)
  return <ChannelAgentContext value={agent}>{children}</ChannelAgentContext>
}

export function useChannelAgentContext() {
  return useContext(ChannelAgentContext)
}
