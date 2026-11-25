import { LOR_USER_ID } from "@repo/db/constants"
import type { TypingIndicatorEvent } from "@repo/realtime-types"
import type { CreatureId, CreatureState } from "@repo/utils/bestiary"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useSocket } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import {
  agentCreature,
  channelAgentOf,
  useAgentsById,
} from "@/hooks/use-agents"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useWorkspaceActivity } from "@/hooks/use-workspace-activity"

export type ChannelAgent = {
  id: string
  channelId: string
  name: string
  creature: CreatureId
}

const WORKING_FOR_MS = 15_000

// Working while a turn runs: the worker beats "agent:working" every 10s, and
// the agent typing counts too. As web's channel-agent.tsx. Until a live event
// arrives, the activity snapshot says whether a turn is already running.
function useAgentWorking(channelId: string, snapshotWorking: boolean) {
  const socket = useSocket()
  // The deadline belongs to the channel that set it.
  const [deadline, setDeadline] = useState<{
    channelId: string | null
    until: number
  }>({ channelId: null, until: 0 })
  const heard = deadline.channelId === channelId
  const until = heard ? deadline.until : 0
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
    // Events missed while offline: the snapshot refreshed on connect decides.
    const onConnect = () => setDeadline({ channelId: null, until: 0 })
    socket.on("typing:update", onTyping)
    socket.on("agent:working", onWorking)
    socket.on("connect", onConnect)
    return () => {
      socket.off("typing:update", onTyping)
      socket.off("agent:working", onWorking)
      socket.off("connect", onConnect)
    }
  }, [socket, channelId])
  const pending = until > Date.now()
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(
      () => setTick((tick) => tick + 1),
      until - Date.now() + 50
    )
    return () => clearTimeout(timer)
  }, [pending, until])
  return heard ? pending : snapshotWorking
}

// The channel's row in the workspace activity snapshot: needs you while one
// of its approvals or questions waits on you. The channel screens keep that
// snapshot themselves: a channel opened by a link has no Channels tab under
// it to fetch it or hear its pushes.
function useAgentActivity(workspaceId: string | undefined, channelId: string) {
  const { data: activity } = useWorkspaceActivity(workspaceId)
  return activity?.find((row) => row.channelId === channelId)
}

const ChannelAgentContext = createContext<ChannelAgent | null>(null)
// Every agent in the channel, first one first: a chat can hold several
// (reference/agents-and-chats.md, decision 32), each posting as its own
// bot user.
const NO_AGENTS: ChannelAgent[] = []
const ChannelAgentsContext = createContext<ChannelAgent[]>(NO_AGENTS)
// Apart from who it is, so a change of state doesn't re-render every message.
const ChannelAgentStateContext = createContext<CreatureState>("asleep")
// A text channel with no agent: plain human chat, where nothing answers @Lor.
const NoChannelAgentContext = createContext(false)

// Lor's messages in a channel's chat and threads are its agent's: the name
// and creature the team picked (reference/agents-and-chats.md), and what it
// is doing now. Null in a channel with no agent, and in sessions, which have
// no provider: Lor stays Lor there.
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
  const agentsById = useAgentsById(workspaceSlug)
  const found = channelAgentOf(channel, agentsById)
  const agent = useMemo(
    () =>
      found
        ? {
            id: found.id,
            channelId,
            name: found.name,
            creature: agentCreature(found),
          }
        : null,
    [found, channelId]
  )
  const agentIds = channel?.agentIds
  const agents = useMemo(
    () =>
      (agentIds ?? []).flatMap((id) => {
        const item = agentsById.get(id)
        return item
          ? {
              id: item.id,
              channelId,
              name: item.name,
              creature: agentCreature(item),
            }
          : []
      }),
    [agentIds, agentsById, channelId]
  )
  const activity = useAgentActivity(workspace?.id, channelId)
  const working = useAgentWorking(channelId, Boolean(activity?.agentWorking))
  const needsYou = Boolean(activity?.agentNeeds.length)
  const state: CreatureState = needsYou
    ? "needs_you"
    : working
      ? "working"
      : "asleep"
  return (
    <ChannelAgentContext value={agent}>
      <ChannelAgentsContext value={agents}>
        <ChannelAgentStateContext value={state}>
          <NoChannelAgentContext
            value={channel?.type === "text" && channel.agentIds.length === 0}
          >
            {children}
          </NoChannelAgentContext>
        </ChannelAgentStateContext>
      </ChannelAgentsContext>
    </ChannelAgentContext>
  )
}

export function useChannelAgent() {
  return useContext(ChannelAgentContext)
}

// Every agent in the channel, for resolving a mention of one.
export function useChannelAgents() {
  return useContext(ChannelAgentsContext)
}

// The agent that wrote a message here (`message.agentId`). One of Lor's own,
// or by an agent no longer in the channel, is shown as the first agent's.
export function useMessageAgent(agentId: string | null | undefined) {
  const first = useContext(ChannelAgentContext)
  const agents = useContext(ChannelAgentsContext)
  return (agentId && agents.find((agent) => agent.id === agentId)) || first
}

export function useChannelAgentState() {
  return useContext(ChannelAgentStateContext)
}

// False outside a channel (sessions), where Lor is the session's agent.
export function useChannelHasNoAgent() {
  return useContext(NoChannelAgentContext)
}

export const AGENT_STATE_TEXT = {
  asleep: "is resting",
  idle: "is here",
  working: "is working",
  needs_you: "is waiting on you",
} as const satisfies Record<CreatureState, string>
