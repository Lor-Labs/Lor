import { queryOptions } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

export const harnessAccountsEndpoint =
  apiClient.v1.workspaces[":workspaceSlug"]["ai-accounts"]

async function loadHarnessAccounts(workspaceSlug: string) {
  const res = await harnessAccountsEndpoint.$get({ param: { workspaceSlug } })
  if (!res.ok) throw new Error("Couldn't load AI accounts")
  return res.json()
}

export function harnessAccountsQueryOptions(workspaceSlug: string) {
  return queryOptions({
    queryKey: ["ai-accounts", workspaceSlug],
    queryFn: () => loadHarnessAccounts(workspaceSlug),
    enabled: Boolean(workspaceSlug),
  })
}

export type HarnessAccountsData = Awaited<
  ReturnType<typeof loadHarnessAccounts>
>
