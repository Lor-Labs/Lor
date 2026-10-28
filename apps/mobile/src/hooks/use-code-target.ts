import { isHarnessEnabled } from "@repo/utils/features"
import { useQuery } from "@tanstack/react-query"
import * as SecureStore from "expo-secure-store"
import { useState } from "react"
import { api } from "@/lib/api"
import { HARNESS_LABELS, type SessionHarness } from "@/lib/harness"

// New session in Code mode: one repo and base branch, fixed for the session,
// and the agent that runs it. Mirrors web's code-target-picker.tsx and
// harness-picker.tsx; the picks are remembered on the device.

export type SessionMode = "chat" | "code"
// `newBranch`: a branch the session makes from `branch` at its start.
export type CodeTarget = { repo: string; branch: string; newBranch?: string }

const MODE_KEY = "lor.new-session-mode"
const HARNESS_KEY = "lor.new-session-harness"
// SecureStore keys allow letters, digits, ".", "-" and "_" only.
const repoKey = (workspaceSlug: string) =>
  `lor.code-repo.${workspaceSlug.replace(/[^\w.-]/g, "_")}`
const branchKey = (workspaceSlug: string, repo: string) =>
  `lor.code-branch.${`${workspaceSlug}.${repo}`.replace(/[^\w.-]/g, "_")}`
const REPOS_STALE_MS = 5 * 60 * 1000
const BRANCHES_STALE_MS = 30 * 1000

const HARNESSES = (["pi", "claude_code", "codex"] as const).filter(
  isHarnessEnabled
)

export const HARNESS_DETAILS: Record<SessionHarness, string> = {
  pi: "Lor's own agent, on Lor credits.",
  claude_code:
    "Runs on your own Claude Pro or Max plan. Each person's messages use their own plan.",
  codex: "OpenAI's coding agent, on Lor credits.",
}

export const HARNESS_OPTIONS = HARNESSES.map((harness) => ({
  value: harness,
  label: HARNESS_LABELS[harness],
  detail: HARNESS_DETAILS[harness],
}))

function readStored(key: string): string | null {
  try {
    return SecureStore.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    SecureStore.setItem(key, value)
  } catch {
    // Best-effort: the pick still applies to this screen.
  }
}

function useStoredChoice<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(
    () => choices.find((choice) => choice === readStored(key)) ?? fallback
  )
  const change = (next: T) => {
    if (!choices.includes(next)) return
    setValue(next)
    writeStored(key, next)
  }
  return [value, change]
}

export function useSessionMode() {
  return useStoredChoice<SessionMode>(MODE_KEY, ["chat", "code"], "chat")
}

export function useSessionHarness() {
  return useStoredChoice<SessionHarness>(HARNESS_KEY, HARNESSES, "pi")
}

type CodeRepos = { available: false } | { available: true; repos: string[] }

export function branchesQueryOptions(
  workspaceSlug: string,
  channelId: string,
  repo: string | null,
  q: string
) {
  return {
    queryKey: ["code-branches", workspaceSlug, channelId, repo, q],
    queryFn: async () => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].code.branches.$get({
        param: { workspaceSlug, channelId },
        query: { repo: repo ?? "", q },
      })
      if (!res.ok) throw new Error("Failed to load branches")
      return res.json()
    },
    enabled: Boolean(repo),
    staleTime: BRANCHES_STALE_MS,
  }
}

export function useCodeTarget({
  workspaceSlug,
  channelId,
  enabled,
}: {
  workspaceSlug: string
  channelId: string
  enabled: boolean
}) {
  const [picked, setPicked] = useState<{
    repo: string
    branch: string | null
    newBranch?: string
  } | null>(null)
  const repos = useQuery({
    queryKey: ["code-repos", workspaceSlug, channelId],
    queryFn: async (): Promise<CodeRepos> => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].connectors[":provider"].scopes.$get({
        param: { workspaceSlug, channelId, provider: "github" },
      })
      // GitHub isn't connected, or this channel's tools leave out clone_repo.
      if (res.status === 403) return { available: false }
      if (!res.ok) throw new Error("Failed to load repositories")
      const { scopes } = await res.json()
      return { available: true, repos: scopes.map((scope) => scope.id) }
    },
    enabled: enabled && Boolean(workspaceSlug),
    staleTime: REPOS_STALE_MS,
  })
  const list = repos.data?.available ? repos.data.repos : []
  const repo =
    [picked?.repo, readStored(repoKey(workspaceSlug))].find(
      (candidate): candidate is string =>
        Boolean(candidate && list.includes(candidate))
    ) ??
    list[0] ??
    null
  const defaults = useQuery({
    ...branchesQueryOptions(workspaceSlug, channelId, repo, ""),
    enabled: enabled && Boolean(repo),
  })
  const defaultBranch = defaults.data?.defaultBranch ?? null
  // The person's last branch for this repo, checked on GitHub first: a
  // deleted or merged one falls back to the default.
  const stored = repo ? readStored(branchKey(workspaceSlug, repo)) : null
  const storedCheck = useQuery({
    ...branchesQueryOptions(workspaceSlug, channelId, repo, stored ?? ""),
    enabled: enabled && Boolean(repo && stored),
  })
  const remembered =
    stored && storedCheck.data?.branches.includes(stored) ? stored : null
  const checking = Boolean(stored) && storedCheck.isPending
  const own = picked?.repo === repo ? picked : null
  const newBranch = own?.newBranch ?? null
  // With a new branch, `branch` is its base: the repo's default branch until
  // one is picked in "from".
  const branch =
    own?.branch ??
    (newBranch
      ? defaultBranch
      : checking
        ? null
        : (remembered ?? defaultBranch))
  const status = repos.isPending
    ? "loading"
    : repos.isError
      ? "error"
      : !repos.data.available
        ? "unavailable"
        : list.length === 0
          ? "empty"
          : "ready"

  return {
    status,
    repos: list,
    repo,
    branch,
    newBranch,
    defaultBranch,
    target:
      repo && branch
        ? { repo, branch, ...(newBranch ? { newBranch } : {}) }
        : null,
    pickRepo: (next: string) => {
      setPicked({ repo: next, branch: null })
      writeStored(repoKey(workspaceSlug), next)
    },
    pickBranch: (next: string) => {
      if (!repo) return
      setPicked({ repo, branch: next })
      writeStored(branchKey(workspaceSlug, repo), next)
    },
    // Not remembered: it isn't on GitHub until the session's first push.
    createBranch: (name: string) => {
      if (repo) setPicked({ repo, branch: null, newBranch: name })
    },
    pickBase: (next: string) => {
      if (repo && newBranch) setPicked({ repo, branch: next, newBranch })
    },
  }
}

export type CodeTargetState = ReturnType<typeof useCodeTarget>

// One line for when there is no repo to pick.
export function codeTargetNote(status: CodeTargetState["status"]): string {
  return status === "loading"
    ? "Loading repositories…"
    : status === "unavailable"
      ? "Code needs GitHub, with Clone repository on in this channel"
      : status === "empty"
        ? "No GitHub repositories connected"
        : "Couldn't load repositories"
}
