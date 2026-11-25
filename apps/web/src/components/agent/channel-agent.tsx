import { LOR_USER_ID } from "@repo/db/constants"
import type {
  ChannelActivity,
  TypingIndicatorEvent,
} from "@repo/realtime-types"
import type { CreatureId, CreatureState } from "@repo/utils/bestiary"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
import { agentCreature, useAgentsById } from "@/hooks/use-agents"
import { workspaceActivityKey } from "@/hooks/use-workspace-activity"
import { channelQueryOptions } from "@/lib/channel-query"

export type ChannelAgent = {
  // The agent's own id: one agent can be in several channels.
  id: string
  channelId: string
  name: string
  creature: CreatureId
  state: CreatureState
}

const WORKING_FOR_MS = 15_000

type WorkingEvent = {
  channelId: string
  working: boolean
  agentId?: string | null
}

const NO_DEADLINES = new Map<string, number>()

// Which of a channel's agents are working: the worker beats "agent:working"
// every 10s while a turn runs (showWorking), and typing counts too. A chat
// can hold several agents, so each event names its agent; one that names
// none is the chat's first agent's.
function useAgentsWorking(
  channelId: string,
  firstAgentId: string | null
): Set<string> {
  const socket = useSocket()
  // The deadlines belong to the channel that set them.
  const [deadlines, setDeadlines] = useState({
    channelId,
    until: NO_DEADLINES,
  })
  const until =
    deadlines.channelId === channelId ? deadlines.until : NO_DEADLINES
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!socket) return
    const set = (agentId: string | null | undefined, at: number) => {
      const id = agentId ?? firstAgentId
      if (!id) return
      setDeadlines((current) => {
        const next = new Map(
          current.channelId === channelId ? current.until : NO_DEADLINES
        )
        if (at > 0) next.set(id, at)
        else next.delete(id)
        return { channelId, until: next }
      })
    }
    const onTyping = (payload: TypingIndicatorEvent) => {
      if (payload.channelId !== channelId || payload.userId !== LOR_USER_ID)
        return
      set(payload.agentId, Date.now() + WORKING_FOR_MS)
    }
    const onWorking = (payload: WorkingEvent) => {
      if (payload.channelId !== channelId) return
      set(payload.agentId, payload.working ? Date.now() + WORKING_FOR_MS : 0)
    }
    socket.on("typing:update", onTyping)
    socket.on("agent:working", onWorking)
    return () => {
      socket.off("typing:update", onTyping)
      socket.off("agent:working", onWorking)
    }
  }, [socket, channelId, firstAgentId])
  const now = Date.now()
  const live = [...until].filter(([, at]) => at > now)
  const soonest = live.length > 0 ? Math.min(...live.map(([, at]) => at)) : 0
  useEffect(() => {
    if (soonest === 0) return
    const timer = setTimeout(
      () => setTick((tick) => tick + 1),
      soonest - Date.now() + 50
    )
    return () => clearTimeout(timer)
  }, [soonest])
  const key = live
    .map(([id]) => id)
    .sort()
    .join(",")
  return useMemo(() => new Set(key ? key.split(",") : []), [key])
}

// The agents in a channel, in the order they were added: each one's name
// and creature, and what it is doing in this channel now
// (reference/agents-and-chats.md, decision 32). Empty when the channel has
// no agent.
export function useChannelAgents(
  workspaceSlug: string | undefined,
  channelId: string
): ChannelAgent[] {
  const { data: channel } = useQuery({
    ...channelQueryOptions(workspaceSlug ?? "", channelId),
    enabled: Boolean(workspaceSlug && channelId),
  })
  // Read from the sidebar's snapshot without becoming one of its observers,
  // so this hook never changes how that query fetches.
  const queryClient = useQueryClient()
  const activityKey = workspaceActivityKey(channel?.workspaceId ?? "")
  const activity = useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => queryClient.getQueryData<ChannelActivity[]>(activityKey)
  )
  const agents = useAgentsById(workspaceSlug)
  const agentIds = channel?.agentIds
  const working = useAgentsWorking(channelId, agentIds?.[0] ?? null)
  // What waits on a person is the channel's, not one agent's: the first
  // agent shows it.
  const needsYou = Boolean(
    activity?.find((row) => row.channelId === channelId)?.agentNeeds.length
  )
  return useMemo(
    () =>
      (agentIds ?? []).flatMap((id, index) => {
        const agent = agents.get(id)
        if (!agent) return []
        return {
          id: agent.id,
          channelId,
          name: agent.name,
          creature: agentCreature(agent),
          state:
            needsYou && index === 0
              ? ("needs_you" as const)
              : working.has(id)
                ? ("working" as const)
                : ("asleep" as const),
        }
      }),
    [agents, agentIds, channelId, needsYou, working]
  )
}

// The agent that answers when nobody is named: the first one added. Null
// when the channel has no agent.
export function useChannelAgent(
  workspaceSlug: string | undefined,
  channelId: string
): ChannelAgent | null {
  return useChannelAgents(workspaceSlug, channelId)[0] ?? null
}

type ChannelAgentsValue = {
  agents: ChannelAgent[]
  // The agent with this id, here or since removed. An agent's id is also
  // its bot user's, so this tells an agent from a person by a user id.
  byId: (id: string | null | undefined) => ChannelAgent | null
  // The agent that wrote a message here (`message.agentId`), or for one of
  // Lor's own the chat's first agent.
  of: (agentId: string | null | undefined) => ChannelAgent | null
}

const NO_CHANNEL_AGENTS: ChannelAgentsValue = {
  agents: [],
  byId: () => null,
  of: () => null,
}
const ChannelAgentsContext =
  createContext<ChannelAgentsValue>(NO_CHANNEL_AGENTS)

// Under this provider an agent's messages wear its name and creature, and
// Lor's own are the chat's first agent's. Session views have none, so Lor
// stays Lor there.
export function ChannelAgentProvider({
  workspaceSlug,
  channelId,
  children,
}: {
  workspaceSlug: string | undefined
  channelId: string
  children: ReactNode
}) {
  const agents = useChannelAgents(workspaceSlug, channelId)
  const all = useAgentsById(workspaceSlug)
  const value = useMemo<ChannelAgentsValue>(() => {
    const first = agents[0] ?? null
    // An agent that has since left the channel keeps its name.
    const byId: ChannelAgentsValue["byId"] = (id) => {
      if (!id) return null
      const placed = agents.find((agent) => agent.id === id)
      if (placed) return placed
      const gone = all.get(id)
      return gone
        ? {
            id: gone.id,
            channelId,
            name: gone.name,
            creature: agentCreature(gone),
            state: "asleep",
          }
        : null
    }
    return { agents, byId, of: (agentId) => byId(agentId) ?? first }
  }, [agents, all, channelId])
  return <ChannelAgentsContext value={value}>{children}</ChannelAgentsContext>
}

// Every agent in the channel.
export function useChannelAgentsContext() {
  return useContext(ChannelAgentsContext).agents
}

// The channel's first agent: the one Lor's own mention, and messages from
// before agents shared a chat, belong to.
export function useChannelAgentContext() {
  return useContext(ChannelAgentsContext).agents[0] ?? null
}

// The agent that wrote a message in this channel.
export function useMessageAgent(agentId: string | null | undefined) {
  return useContext(ChannelAgentsContext).of(agentId)
}

// Tells an agent from a person by a user id: the agent, or null.
export function useAgentById() {
  return useContext(ChannelAgentsContext).byId
}

// The same lookup for a list, where a hook per row can't be called.
export function useAgentOf() {
  return useContext(ChannelAgentsContext).of
}
