import {
  ArrowDown01Icon,
  BubbleChatIcon,
  GitBranchIcon,
  GithubIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Combobox, ComboboxPrimitive } from "@repo/ui/components/combobox"
import { Spinner } from "@repo/ui/components/spinner"
import { ToggleGroup, ToggleGroupItem } from "@repo/ui/components/toggle-group"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"

// New session in Code mode: one repo and base branch, fixed for the session
// (reference/planned/code-sessions-runbook.md, chunk 1).

export type SessionMode = "chat" | "code"
export type CodeTarget = { repo: string; branch: string }

const MODE_KEY = "lor:new-session-mode"
const repoKey = (workspaceSlug: string) => `lor:code-repo:${workspaceSlug}`
const branchKey = (workspaceSlug: string, repo: string) =>
  `lor:code-branch:${workspaceSlug}:${repo}`
const SEARCH_DEBOUNCE_MS = 200
const REPOS_STALE_MS = 5 * 60 * 1000
const BRANCHES_STALE_MS = 30 * 1000

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

// `start` opens on that mode (Continue in Code) without changing the saved
// choice; switching still saves.
export function useSessionMode(
  start?: SessionMode
): [SessionMode, (mode: SessionMode) => void] {
  const [mode, setMode] = useState<SessionMode>(
    () => start ?? (readStored(MODE_KEY) === "code" ? "code" : "chat")
  )
  const change = (next: SessionMode) => {
    setMode(next)
    writeStored(MODE_KEY, next)
  }
  return [mode, change]
}

export function SessionModeSwitch({
  mode,
  onChange,
}: {
  mode: SessionMode
  onChange: (mode: SessionMode) => void
}) {
  return (
    <ToggleGroup
      size="sm"
      aria-label="Session mode"
      value={[mode]}
      onValueChange={(value) => {
        const next = value[0]
        if (next === "chat" || next === "code") onChange(next)
      }}
    >
      <ToggleGroupItem value="chat" className="h-7 px-2 text-xs">
        <HugeiconsIcon icon={BubbleChatIcon} className="size-3.5" />
        Chat
      </ToggleGroupItem>
      <ToggleGroupItem value="code" className="h-7 px-2 text-xs">
        <HugeiconsIcon icon={SourceCodeIcon} className="size-3.5" />
        Code
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

type CodeRepos = { available: false } | { available: true; repos: string[] }

function branchesQueryOptions(
  workspaceSlug: string,
  channelId: string,
  repo: string | null,
  q: string
) {
  return {
    queryKey: ["code-branches", workspaceSlug, channelId, repo, q],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].code.branches.$get({
        param: { workspaceSlug, channelId },
        query: { repo: repo as string, q },
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
  } | null>(null)
  const repos = useQuery({
    queryKey: ["code-repos", workspaceSlug, channelId],
    queryFn: async (): Promise<CodeRepos> => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
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
    enabled,
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
  const branch =
    (picked?.repo === repo ? picked.branch : null) ??
    (checking ? null : (remembered ?? defaultBranch))
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
    defaultBranch,
    target: repo && branch ? { repo, branch } : null,
    pickRepo: (next: string) => {
      setPicked({ repo: next, branch: null })
      writeStored(repoKey(workspaceSlug), next)
    },
    pickBranch: (next: string) => {
      if (!repo) return
      setPicked({ repo, branch: next })
      writeStored(branchKey(workspaceSlug, repo), next)
    },
  }
}

export type CodeTargetState = ReturnType<typeof useCodeTarget>

// Sits after Chat | Code in the strip above the New session composer.
export function CodeTargetPicker({
  workspaceSlug,
  channelId,
  code,
}: {
  workspaceSlug: string
  channelId: string
  code: CodeTargetState
}) {
  if (code.status !== "ready" || !code.repo) {
    const note =
      code.status === "loading"
        ? "Loading repositories…"
        : code.status === "unavailable"
          ? "Code needs GitHub, with Clone repository on in this channel"
          : code.status === "empty"
            ? "No GitHub repositories connected"
            : "Couldn't load repositories"
    return (
      <span className="min-w-0 truncate text-muted-foreground">{note}</span>
    )
  }
  return (
    <>
      <SearchPicker
        icon={GithubIcon}
        value={code.repo}
        label={code.repo.split("/")[1] ?? code.repo}
        items={code.repos}
        placeholder="Find a repository…"
        emptyText="No repositories found"
        onPick={code.pickRepo}
      />
      <BranchPicker
        workspaceSlug={workspaceSlug}
        channelId={channelId}
        code={code}
      />
    </>
  )
}

function BranchPicker({
  workspaceSlug,
  channelId,
  code,
}: {
  workspaceSlug: string
  channelId: string
  code: CodeTargetState
}) {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])
  // Typing filters the branches already loaded at once; GitHub's name search
  // runs behind it and adds the ones past the first page.
  const listed = useQuery({
    ...branchesQueryOptions(workspaceSlug, channelId, code.repo, ""),
    enabled: open && Boolean(code.repo),
  })
  const search = debouncedQuery.trim()
  const searched = useQuery({
    ...branchesQueryOptions(workspaceSlug, channelId, code.repo, search),
    enabled: open && Boolean(code.repo) && search !== "",
    placeholderData: (previous) => previous,
  })
  const searching =
    searched.isFetching || query.trim() !== debouncedQuery.trim()

  if (!code.branch) {
    return <Spinner className="size-3.5 text-muted-foreground" />
  }
  return (
    <SearchPicker
      icon={GitBranchIcon}
      value={code.branch}
      items={[
        ...new Set([
          ...(listed.data?.branches ?? []),
          ...(searched.data?.branches ?? []),
          code.branch,
        ]),
      ]}
      placeholder="Find a branch…"
      emptyText={searching ? "Searching GitHub…" : "No branches found"}
      onPick={code.pickBranch}
      onOpenChange={setOpen}
      onQueryChange={setQuery}
      loading={searching && query.trim() !== ""}
      badgeFor={(branch) => (branch === code.defaultBranch ? "default" : null)}
    />
  )
}

// A Linear-style picker: search input in the popup, rows styled like
// MenuItem (see thread-subscribers.tsx). The list filters as you type;
// onQueryChange lets the caller also search the server and add its results.
function SearchPicker({
  icon,
  value,
  label = value,
  items,
  placeholder,
  emptyText,
  onPick,
  onOpenChange,
  onQueryChange,
  loading = false,
  badgeFor,
}: {
  icon: IconSvgElement
  value: string
  // Shown on the trigger; the full value is its tooltip.
  label?: string
  items: string[]
  placeholder: string
  emptyText: string
  onPick: (value: string) => void
  onOpenChange?: (open: boolean) => void
  onQueryChange?: (query: string) => void
  loading?: boolean
  badgeFor?: (item: string) => string | null
}) {
  const [query, setQuery] = useState("")
  const changeQuery = (next: string) => {
    setQuery(next)
    onQueryChange?.(next)
  }
  return (
    <Combobox<string>
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next) onPick(next)
      }}
      inputValue={query}
      onInputValueChange={changeQuery}
      onOpenChange={(open) => {
        onOpenChange?.(open)
        if (!open) changeQuery("")
      }}
    >
      <ComboboxPrimitive.Trigger
        title={value}
        className="inline-flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground data-popup-open:bg-foreground/[0.04] data-popup-open:text-foreground"
      >
        <HugeiconsIcon
          icon={icon}
          className="size-3.5 shrink-0"
          strokeWidth={2}
        />
        <span className="max-w-48 truncate">{label}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3 shrink-0"
          strokeWidth={2}
        />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          align="start"
          sideOffset={4}
          className="z-50"
        >
          <ComboboxPrimitive.Popup className="w-72 origin-(--transform-origin) overflow-hidden rounded-lg border bg-popover text-foreground shadow-lg/5 outline-none not-dark:bg-clip-padding">
            <div className="flex items-center gap-2 border-b border-border/70 py-1.5 ps-3 pe-2">
              <ComboboxPrimitive.Input
                placeholder={placeholder}
                className="h-6 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              />
              {loading && (
                <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </div>
            <ComboboxPrimitive.Empty className="px-3 py-2 text-[13px] text-muted-foreground empty:hidden">
              {emptyText}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="max-h-64 overflow-y-auto p-1 empty:hidden">
              {(item: string) => (
                <ComboboxPrimitive.Item
                  key={item}
                  value={item}
                  className="group flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-[13px] outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="min-w-0 truncate">{item}</span>
                  {badgeFor?.(item) && (
                    <span className="shrink-0 text-muted-foreground">
                      {badgeFor(item)}
                    </span>
                  )}
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    className="ml-auto size-3.5 shrink-0 opacity-0 group-data-selected:opacity-100"
                    strokeWidth={2}
                  />
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </Combobox>
  )
}
