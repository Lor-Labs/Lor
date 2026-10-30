import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { apiClient } from "@/lib/api-client"

// Environments for code sessions (reference/dev-environment-runbook.md §2):
// the list for a repo, and the one the New session view picked for it,
// remembered per repo like the branch.

export const environmentsKey = (workspaceSlug: string, repo: string | null) =>
  ["environments", workspaceSlug, repo] as const

export function environmentsQueryOptions(
  workspaceSlug: string,
  repo: string | null
) {
  return {
    queryKey: environmentsKey(workspaceSlug, repo),
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].environments.$get({
        param: { workspaceSlug },
        query: repo ? { repo } : {},
      })
      if (!res.ok) throw new Error("Failed to load environments")
      return res.json()
    },
    enabled: Boolean(repo),
  }
}

export type EnvironmentList = Awaited<
  ReturnType<ReturnType<typeof environmentsQueryOptions>["queryFn"]>
>
export type EnvironmentSummary = EnvironmentList["environments"][number]

const pickKey = (workspaceSlug: string, repo: string) =>
  `lor:code-environment:${workspaceSlug}:${repo}`

function readPick(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writePick(key: string, id: string | null) {
  try {
    if (id) localStorage.setItem(key, id)
    else localStorage.removeItem(key)
  } catch {}
}

export function useCodeEnvironment(workspaceSlug: string, repo: string | null) {
  const list = useQuery(environmentsQueryOptions(workspaceSlug, repo))
  const [picked, setPicked] = useState<{
    repo: string
    id: string | null
  } | null>(null)
  const id =
    repo && picked?.repo === repo
      ? picked.id
      : repo
        ? readPick(pickKey(workspaceSlug, repo))
        : null
  const environments = list.data?.environments ?? []
  return {
    environments,
    canManage: list.data?.canManage ?? false,
    loading: list.isPending && Boolean(repo),
    failed: list.isError,
    retry: () => void list.refetch(),
    // A remembered pick that was deleted reads as none.
    selected: environments.find((env) => env.id === id) ?? null,
    select: (next: string | null) => {
      if (!repo) return
      setPicked({ repo, id: next })
      writePick(pickKey(workspaceSlug, repo), next)
    },
  }
}

export type CodeEnvironmentState = ReturnType<typeof useCodeEnvironment>
