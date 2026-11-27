import type { InferResponseType } from "@repo/api-client"
import { type CreatureId, isCreatureId } from "@repo/utils/bestiary"
import {
  type QueryClient,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useMemo } from "react"
import { useSocket } from "@/context/socket-context"
import { api, responseMessage } from "@/lib/api"

// Agents apart from channels (reference/agents-and-chats.md): a workspace's
// agents, and the ones a channel holds. A channel carries only `agentIds`;
// an agent's name, face, brief and model come from this list. Mirrors web's
// use-agents.ts.

const agentsRoute = api.v1.workspaces[":workspaceSlug"].agents

export type WorkspaceAgent = InferResponseType<
  typeof agentsRoute.$get,
  200
>["agents"][number]

export const agentsKey = (workspaceSlug: string) =>
  ["agents", workspaceSlug] as const

export function agentsQueryOptions(workspaceSlug: string) {
  return queryOptions({
    queryKey: agentsKey(workspaceSlug),
    queryFn: async () => {
      const res = await agentsRoute.$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to fetch agents")
      return (await res.json()).agents
    },
    staleTime: 60_000,
  })
}

const NO_AGENTS: WorkspaceAgent[] = []

// The agents this person can see. Refetched when one is made, changed or
// deleted, or a channel gets a different agent ("agents:updated").
export function useAgents(workspaceSlug: string | undefined) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    ...agentsQueryOptions(workspaceSlug ?? ""),
    enabled: Boolean(workspaceSlug),
  })

  useEffect(() => {
    if (!socket || !workspaceSlug) return
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: agentsKey(workspaceSlug) })
      // Which agent a channel holds rides on the channel.
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
      })
      void queryClient.invalidateQueries({
        queryKey: ["channel", workspaceSlug],
      })
    }
    socket.on("agents:updated", refresh)
    return () => {
      socket.off("agents:updated", refresh)
    }
  }, [socket, workspaceSlug, queryClient])

  return data ?? NO_AGENTS
}

export function useAgentsById(workspaceSlug: string | undefined) {
  const agents = useAgents(workspaceSlug)
  return useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents]
  )
}

// The agent that answers in a channel, or null: a channel with no agent is
// plain human chat. The data allows several; the first one added answers.
// Null too while the agents are still loading.
export function channelAgentOf(
  channel: { agentIds?: string[] } | null | undefined,
  agents: Map<string, WorkspaceAgent>
): WorkspaceAgent | null {
  const first = channel?.agentIds?.[0]
  return (first && agents.get(first)) || null
}

// An agent's face. A stored creature is always one of the bestiary's; the
// fallback only satisfies the type.
export function agentCreature(agent: { creature: string }): CreatureId {
  return isCreatureId(agent.creature) ? agent.creature : "kraken"
}

// Which agents are in a chat. An empty list leaves plain human chat.
export async function setChannelAgents(
  workspaceSlug: string,
  channelId: string,
  agentIds: string[]
) {
  const res = await api.v1.workspaces[":workspaceSlug"].channels[
    ":channelId"
  ].$patch({ param: { workspaceSlug, channelId }, json: { agentIds } })
  if (!res.ok)
    throw new Error(await responseMessage(res, "Couldn't change the agents"))
  return res.json()
}

// After an agent or a chat's agents changed: everything that shows them.
export function refreshAgents(queryClient: QueryClient, workspaceSlug: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: agentsKey(workspaceSlug) }),
    queryClient.invalidateQueries({ queryKey: ["channels", workspaceSlug] }),
    queryClient.invalidateQueries({ queryKey: ["channel", workspaceSlug] }),
    queryClient.invalidateQueries({ queryKey: ["chats", workspaceSlug] }),
  ])
}
