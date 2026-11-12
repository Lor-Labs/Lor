import { useQuery } from "@tanstack/react-query"
import * as SecureStore from "expo-secure-store"
import { useState } from "react"
import { api } from "@/lib/api"

// Environments for code sessions (reference/dev-environment-runbook.md §2):
// the list for a repo, and the one New session picked for it, remembered
// per repo on the device like the branch. Mirrors web's use-environments.ts.
// Creating and editing an environment's env files stays on web.

export const environmentsKey = (workspaceSlug: string, repo: string | null) =>
  ["environments", workspaceSlug, repo] as const

export function environmentsQueryOptions(
  workspaceSlug: string,
  repo: string | null
) {
  return {
    queryKey: environmentsKey(workspaceSlug, repo),
    queryFn: async () => {
      const res = await api.v1.workspaces[":workspaceSlug"].environments.$get({
        param: { workspaceSlug },
        query: repo ? { repo } : {},
      })
      if (!res.ok) throw new Error("Failed to load environments")
      return res.json()
    },
    enabled: Boolean(workspaceSlug && repo),
  }
}

export type EnvironmentList = Awaited<
  ReturnType<ReturnType<typeof environmentsQueryOptions>["queryFn"]>
>
export type EnvironmentSummary = EnvironmentList["environments"][number]

// SecureStore keys allow letters, digits, ".", "-" and "_" only.
const pickKey = (workspaceSlug: string, repo: string) =>
  `lor.code-environment.${`${workspaceSlug}.${repo}`.replace(/[^\w.-]/g, "_")}`

function readPick(key: string): string | null {
  try {
    return SecureStore.getItem(key)
  } catch {
    return null
  }
}

function writePick(key: string, id: string | null) {
  try {
    if (id) SecureStore.setItem(key, id)
    else void SecureStore.deleteItemAsync(key)
  } catch {
    // Best-effort: the pick still applies to this screen.
  }
}

export function useCodeEnvironment(
  workspaceSlug: string,
  repo: string | null,
  enabled = true
) {
  const list = useQuery({
    ...environmentsQueryOptions(workspaceSlug, repo),
    enabled: enabled && Boolean(workspaceSlug && repo),
  })
  const [picked, setPicked] = useState<{
    workspaceSlug: string
    repo: string
    id: string | null
  } | null>(null)
  const id =
    repo && picked?.repo === repo && picked.workspaceSlug === workspaceSlug
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
      setPicked({ workspaceSlug, repo, id: next })
      writePick(pickKey(workspaceSlug, repo), next)
    },
  }
}

export type CodeEnvironmentState = ReturnType<typeof useCodeEnvironment>
