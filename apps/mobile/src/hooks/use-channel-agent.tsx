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
import { useQueryClient } from "@tanstack/react-query"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { useSocket } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { workspaceActivityKey } from "@/hooks/use-workspace-activity"

export type ChannelAgent = {
  channelId: string
  name: string
  creature: CreatureId
}

const WORKING_FOR_MS = 15_000

// Working while a turn runs: the worker beats "agent:working" every 10s, and
// the agent typing counts too. As web's channel-agent.tsx.
function useAgentWorking(channelId: string) {
  const socket = useSocket()
  // The deadline belongs to the channel that set it.
  const [deadline, setDeadline] = useState({ channelId, until: 0 })
  const until = deadline.channelId === channelId ? deadline.until : 0
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!socket) return
    const onTyping = (payload: TypingIndicatorEvent) => {
      if (payload.channelId !== channelId || payload.userId !== LOR_USER_ID)
        return
      setDeadline({ channelId, until: Date.now() + WORKING_FOR_MS })
    }
    const onWorking = (payload: { channelId: string; working: boolean }) => {
      if (payload.channelId !== channelId) return
      setDeadline({
        channelId,
        until: payload.working ? Date.now() + WORKING_FOR_MS : 0,
      })
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

// Needs you while one of its approvals or questions waits on you. Read from
// the Channels tab's snapshot without becoming one of its observers, so this
// never changes how that query fetches.
function useAgentNeedsYou(workspaceId: string | undefined, channelId: string) {
  const queryClient = useQueryClient()
  const key = workspaceActivityKey(workspaceId ?? "")
  const activity = useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => queryClient.getQueryData<ChannelActivity[]>(key)
  )
  return Boolean(
    activity?.find((row) => row.channelId === channelId)?.agentNeeds.length
  )
}

const ChannelAgentContext = createContext<ChannelAgent | null>(null)
// Apart from who it is, so a change of state doesn't re-render every message.
const ChannelAgentStateContext = createContext<CreatureState>("asleep")

// Lor's messages in a text channel's chat and threads are its agent's: the
// name and creature the team picked (reference/always-on-agents.md,
// decisions 32 and 33), and what it is doing now. Sessions have no provider,
// so Lor stays Lor there.
export function ChannelAgentProvider({
  workspaceSlug,
  channelId,
  children,
}: {
  workspaceSlug: string
  channelId: string
  children: ReactNode
}) {
  const { workspace } = useWorkspace()
  const { channel } = useChannelDetail({ workspaceSlug, channelId })
  const agent = useMemo(
    () =>
      channel && channel.type === "text"
        ? { channelId: channel.id, ...channelAgentIdentity(channel) }
        : null,
    [channel]
  )
  const working = useAgentWorking(channelId)
  const needsYou = useAgentNeedsYou(workspace?.id, channelId)
  const state: CreatureState = needsYou
    ? "needs_you"
    : working
      ? "working"
      : "asleep"
  return (
    <ChannelAgentContext value={agent}>
      <ChannelAgentStateContext value={state}>
        {children}
      </ChannelAgentStateContext>
    </ChannelAgentContext>
  )
}

export function useChannelAgent() {
  return useContext(ChannelAgentContext)
}

export function useChannelAgentState() {
  return useContext(ChannelAgentStateContext)
}

export const AGENT_STATE_TEXT = {
  asleep: "is resting",
  idle: "is here",
  working: "is working",
  needs_you: "is waiting on you",
} as const satisfies Record<CreatureState, string>
