import { queryOptions, useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useMemo, useSyncExternalStore } from "react"
import type { SessionHarness } from "@/components/session/harness-picker"
import { apiClient } from "@/lib/api-client"

// A harness's models for the composer's picker, with each model's effort
// levels and fast mode, read from the harness's own catalog on the server.

async function fetchAgentModels(
  harness: SessionHarness,
  workspaceSlug: string
) {
  const res = await apiClient.v1.workspaces[":workspaceSlug"][
    "agent-models"
  ].$get({ param: { workspaceSlug }, query: { harness } })
  if (!res.ok) throw new Error("Failed to load models")
  return res.json()
}

export type AgentModels = Awaited<ReturnType<typeof fetchAgentModels>>
export type AgentModelOption = AgentModels["models"][number]

export const agentModelsKey = (harness: SessionHarness) =>
  ["agent-models", harness] as const

export const agentModelsQueryOptions = (
  harness: SessionHarness,
  workspaceSlug: string
) =>
  queryOptions({
    queryKey: [...agentModelsKey(harness), workspaceSlug],
    queryFn: () => fetchAgentModels(harness, workspaceSlug),
    enabled: Boolean(workspaceSlug),
    // The catalog changes with a deploy, or after a turn reports the
    // person's own Claude Code models.
    staleTime: 10 * 60 * 1000,
  })

// The person's model, effort and fast mode per harness, remembered for every
// composer on the page. The Claude and Codex model keys predate the catalog.
const KEY_PREFIX: Record<SessionHarness, string> = {
  pi: "lor:pi",
  claude_code: "lor:claude",
  codex: "lor:codex",
}
const remembered = new Map<string, string | null>()
const listeners = new Set<() => void>()

function readRemembered(key: string): string | null {
  if (!remembered.has(key)) {
    let value: string | null = null
    try {
      value = localStorage.getItem(key)
    } catch {}
    remembered.set(key, value)
  }
  return remembered.get(key) ?? null
}

function remember(key: string, value: string | null) {
  remembered.set(key, value)
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
  for (const listener of listeners) listener()
}

// Sign-out: a session's picks (keys ending @<session>) must not carry over
// to the next account in this browser.
export function clearSessionPicks() {
  const prefixes = Object.values(KEY_PREFIX)
  const isSessionPick = (key: string) =>
    key.includes("@") && prefixes.some((prefix) => key.startsWith(prefix))
  try {
    for (const key of Object.keys(localStorage)) {
      if (isSessionPick(key)) localStorage.removeItem(key)
    }
  } catch {}
  for (const key of [...remembered.keys()]) {
    if (isSessionPick(key)) remembered.delete(key)
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function useRemembered(key: string | null) {
  return useSyncExternalStore(subscribe, () =>
    key === null ? null : readRemembered(key)
  )
}

// A session remembers its own picks (LOR-160): switching sessions never
// changes another session's model, which would bust its prompt cache. A
// session's keys hold every pick explicitly ("" = default effort), so they
// never fall through to the person's last pick elsewhere.
const pickKey = (
  harness: SessionHarness,
  field: "model" | "effort" | "fast",
  sessionScope?: string | null
) => `${KEY_PREFIX[harness]}-${field}${sessionScope ? `@${sessionScope}` : ""}`

// Picking in a session also becomes the person's pick for new sessions.
export function rememberModel(
  harness: SessionHarness,
  model: string,
  sessionScope?: string | null
) {
  if (sessionScope) remember(pickKey(harness, "model", sessionScope), model)
  remember(pickKey(harness, "model"), model)
}

// null: the harness's default effort.
export function rememberEffort(
  harness: SessionHarness,
  effort: string | null,
  sessionScope?: string | null
) {
  if (sessionScope)
    remember(pickKey(harness, "effort", sessionScope), effort ?? "")
  remember(pickKey(harness, "effort"), effort)
}

export function rememberFast(
  harness: SessionHarness,
  fast: boolean,
  sessionScope?: string | null
) {
  if (sessionScope)
    remember(pickKey(harness, "fast", sessionScope), String(fast))
  remember(pickKey(harness, "fast"), fast ? "true" : null)
}

// What a session's newest run used, from its reply (any device, any sender).
export type SessionTurnPick = {
  model: string
  effort: string | null
  fast: boolean
}

// A session's own picks, or for a session this browser never picked in, what
// its newest run used.
export type ModelScope = {
  sessionScope: string
  lastTurn: SessionTurnPick | null
}

export type ModelChoice = {
  harness: SessionHarness
  workspaceSlug: string
  // The session the picks are remembered for; null: the new-session view.
  sessionScope: string | null
  catalog: AgentModels | undefined
  option: AgentModelOption | undefined
  // null: the harness's default.
  effort: string | null
  fast: boolean
  // What a message sends for its turn.
  turn: { model?: string; effort?: string; fast?: boolean }
}

// Keeps a session on the picks its message went with, even when the person
// later picks differently elsewhere.
export function pinSessionChoice(choice: ModelChoice) {
  const { harness, sessionScope, option } = choice
  if (!sessionScope || !option) return
  remember(pickKey(harness, "model", sessionScope), option.id)
  remember(pickKey(harness, "effort", sessionScope), choice.effort ?? "")
  remember(pickKey(harness, "fast", sessionScope), String(choice.fast))
}

// The remembered choice, held to what the catalog offers: a model it no
// longer lists falls back to its default, an effort the model doesn't take
// to the catalog's default effort. Until the catalog loads, the server
// chooses the workspace default; never send a stale cross-provider choice.
export function useModelChoice(
  harness: SessionHarness,
  scope?: ModelScope
): ModelChoice {
  const { workspaceSlug = "" } = useParams({ strict: false })
  const { data: catalog } = useQuery(
    agentModelsQueryOptions(harness, workspaceSlug)
  )
  const sessionScope = scope?.sessionScope ?? null
  const lastTurn = scope?.lastTurn ?? null
  const savedModel = useRemembered(pickKey(harness, "model"))
  const savedEffort = useRemembered(pickKey(harness, "effort"))
  const savedFast = useRemembered(pickKey(harness, "fast")) === "true"
  const sessionModel = useRemembered(
    sessionScope ? pickKey(harness, "model", sessionScope) : null
  )
  const sessionEffort = useRemembered(
    sessionScope ? pickKey(harness, "effort", sessionScope) : null
  )
  const sessionFast = useRemembered(
    sessionScope ? pickKey(harness, "fast", sessionScope) : null
  )
  const wantedModel = sessionModel ?? lastTurn?.model ?? savedModel
  const wantedEffort =
    sessionEffort !== null
      ? sessionEffort || null
      : lastTurn
        ? lastTurn.effort
        : savedEffort
  const wantedFast =
    sessionFast !== null
      ? sessionFast === "true"
      : lastTurn
        ? lastTurn.fast
        : savedFast
  const option =
    catalog?.models.find((model) => model.id === wantedModel) ??
    catalog?.models.find((model) => model.id === catalog.defaultModel)
  const effort = !option
    ? null
    : ([wantedEffort, catalog?.defaultEffort].find(
        (level): level is string =>
          typeof level === "string" && option.efforts.includes(level)
      ) ?? null)
  const fast = Boolean(option?.fast && wantedFast)
  // Stable between changes: the session composer's pickers are memoized on it.
  return useMemo(() => {
    const model = option?.id
    return {
      harness,
      workspaceSlug,
      sessionScope,
      catalog,
      option,
      effort,
      fast,
      turn: {
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(fast ? { fast } : {}),
      },
    }
  }, [harness, workspaceSlug, sessionScope, catalog, option, effort, fast])
}

// A Lor reply's model as its session's picker names it ("Opus"), with the
// exact model when the name hides it.
export type RunModelLabel = { name: string; exact: string | null }

export function runModelLabel(
  catalog: AgentModels | undefined,
  model: string
): RunModelLabel {
  const option = catalog?.models.find((candidate) => candidate.id === model)
  if (!option) return { name: model.split("/").at(-1) ?? model, exact: model }
  const exact = option.resolvedModel ?? option.id
  return { name: option.name, exact: exact === option.name ? null : exact }
}
