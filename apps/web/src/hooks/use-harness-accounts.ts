import { queryOptions } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

export const harnessAccountsEndpoint =
  apiClient.v1.workspaces[":workspaceSlug"]["ai-accounts"]

// With an agent, its own run settings come along; the accounts are the
// workspace's either way.
async function loadHarnessAccounts(workspaceSlug: string, agentId?: string) {
  const res = await harnessAccountsEndpoint.$get({
    param: { workspaceSlug },
    query: agentId ? { agentId } : {},
  })
  if (!res.ok) throw new Error("Couldn't load AI accounts")
  return res.json()
}

export function harnessAccountsQueryOptions(
  workspaceSlug: string,
  agentId?: string
) {
  return queryOptions({
    queryKey: agentId
      ? ["ai-accounts", workspaceSlug, agentId]
      : ["ai-accounts", workspaceSlug],
    queryFn: () => loadHarnessAccounts(workspaceSlug, agentId),
    enabled: Boolean(workspaceSlug),
  })
}

export type HarnessAccountsData = Awaited<
  ReturnType<typeof loadHarnessAccounts>
>
