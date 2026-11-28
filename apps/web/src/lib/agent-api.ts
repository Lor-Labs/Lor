import type { QueryClient } from "@tanstack/react-query"
import { agentsKey, type WorkspaceAgent } from "@/hooks/use-agents"
import { apiClient } from "@/lib/api-client"
import { channelQueryOptions } from "@/lib/channel-query"

// Calls for agents apart from channels (reference/agents-and-chats.md).

const workspaces = apiClient.v1.workspaces[":workspaceSlug"]

async function failure(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

export type AgentChanges = {
  name?: string
  creature?: WorkspaceAgent["creature"]
  role?: string | null
  brief?: string | null
  model?: string | null
  agentProfileId?: string | null
}

export async function saveAgent(
  workspaceSlug: string,
  agentId: string,
  changes: AgentChanges
): Promise<WorkspaceAgent> {
  const res = await workspaces.agents[":agentId"].$patch({
    param: { workspaceSlug, agentId },
    // The server checks the creature against the bestiary.
    json: changes as Parameters<
      (typeof workspaces.agents)[":agentId"]["$patch"]
    >[0]["json"],
  })
  if (!res.ok) throw await failure(res, "Failed to save the agent")
  return res.json()
}

export async function createAgent(
  workspaceSlug: string,
  input: AgentChanges
): Promise<WorkspaceAgent> {
  const res = await workspaces.agents.$post({
    param: { workspaceSlug },
    json: input as Parameters<typeof workspaces.agents.$post>[0]["json"],
  })
  if (!res.ok) throw await failure(res, "Failed to make the agent")
  return res.json()
}

export async function deleteAgent(workspaceSlug: string, agentId: string) {
  const res = await workspaces.agents[":agentId"].$delete({
    param: { workspaceSlug, agentId },
  })
  if (!res.ok) throw await failure(res, "Failed to delete the agent")
}

// Which agents are in a channel. An empty list leaves plain human chat.
export async function setChannelAgents(
  workspaceSlug: string,
  channelId: string,
  agentIds: string[]
) {
  const res = await workspaces.channels[":channelId"].$patch({
    param: { workspaceSlug, channelId },
    json: { agentIds },
  })
  if (!res.ok) throw await failure(res, "Failed to change the chat's agent")
  return res.json()
}

// After an agent or a channel's agents changed: everything that shows them.
export function refreshAgents(queryClient: QueryClient, workspaceSlug: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: agentsKey(workspaceSlug) }),
    queryClient.invalidateQueries({ queryKey: ["channels", workspaceSlug] }),
    queryClient.invalidateQueries({ queryKey: ["channel", workspaceSlug] }),
  ])
}

// An agent's instructions for one channel, readable by the people who can
// see that channel.
export const channelAgentsKey = (workspaceSlug: string, channelId: string) =>
  [...channelQueryOptions(workspaceSlug, channelId).queryKey, "agents"] as const

export async function loadChannelAgents(
  workspaceSlug: string,
  channelId: string
) {
  const res = await workspaces.channels[":channelId"].agents.$get({
    param: { workspaceSlug, channelId },
  })
  if (!res.ok) throw await failure(res, "Failed to load the chat's agents")
  return (await res.json()).agents
}

export async function saveChannelBrief(
  workspaceSlug: string,
  channelId: string,
  agentId: string,
  brief: string | null
) {
  const res = await workspaces.channels[":channelId"].agents[":agentId"].$patch(
    { param: { workspaceSlug, channelId, agentId }, json: { brief } }
  )
  if (!res.ok) throw await failure(res, "Failed to save the instructions")
  return res.json()
}
