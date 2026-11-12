import type { SendMessagePayload } from "@repo/realtime-types"
import { queryOptions, useQuery } from "@tanstack/react-query"
import * as SecureStore from "expo-secure-store"
import { createContext, useMemo, useSyncExternalStore } from "react"
import { api } from "@/lib/api"
import type { SessionHarness } from "@/lib/harness"

// A harness's models for the composer's picker, with each model's effort
// levels and fast mode, read from the harness's own catalog on the server.
// Mirrors web's use-agent-models.ts; the picks are remembered on the device.

async function fetchAgentModels(
  harness: SessionHarness,
  workspaceSlug: string
) {
  const res = await api.v1.workspaces[":workspaceSlug"]["agent-models"].$get({
    param: { workspaceSlug },
    query: { harness },
  })
  if (!res.ok) throw new Error("Failed to load models")
  return res.json()
}

export type AgentModels = Awaited<ReturnType<typeof fetchAgentModels>>
export type AgentModelOption = AgentModels["models"][number]

export const agentModelsQueryOptions = (
  harness: SessionHarness,
  workspaceSlug: string
) =>
  queryOptions({
    queryKey: ["agent-models", harness, workspaceSlug] as const,
    queryFn: () => fetchAgentModels(harness, workspaceSlug),
    enabled: Boolean(workspaceSlug),
    staleTime: 10 * 60 * 1000,
  })

// SecureStore keys allow letters, digits, ".", "-" and "_" only.
const KEY_PREFIX: Record<SessionHarness, string> = {
  pi: "lor.pi",
  claude_code: "lor.claude",
  codex: "lor.codex",
}
const remembered = new Map<string, string | null>()
const listeners = new Set<() => void>()

function readRemembered(key: string): string | null {
  if (!remembered.has(key)) {
    let value: string | null = null
    try {
      value = SecureStore.getItem(key)
    } catch {}
    remembered.set(key, value)
  }
  return remembered.get(key) ?? null
}

function remember(key: string, value: string | null) {
  remembered.set(key, value)
  try {
    if (value === null) void SecureStore.deleteItemAsync(key)
    else SecureStore.setItem(key, value)
  } catch {
    // Best-effort: the pick still applies until the app restarts.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function useRemembered(key: string) {
  return useSyncExternalStore(subscribe, () => readRemembered(key))
}

// A session remembers its own picks (LOR-160), so switching sessions never
// changes another session's model, which would bust its prompt cache. One
// SecureStore entry holds them all (its values are small), newest sessions
// only; an older session falls back to what its last run used.
type SessionPick = { model: string; effort: string | null; fast: boolean }
const SESSION_PICKS_KEY = "lor.session-picks"
const MAX_SESSION_PICKS = 12
let sessionPicks: Record<string, SessionPick> | null = null

function readSessionPicks(): Record<string, SessionPick> {
  if (!sessionPicks) {
    sessionPicks = {}
    try {
      const stored = SecureStore.getItem(SESSION_PICKS_KEY)
      if (stored) sessionPicks = JSON.parse(stored)
    } catch {}
  }
  return sessionPicks ?? {}
}

function rememberSessionPick(sessionScope: string, pick: SessionPick) {
  const { [sessionScope]: _previous, ...others } = readSessionPicks()
  // Insertion order is recency: the oldest sessions drop off the front.
  const kept = Object.entries(others).slice(1 - MAX_SESSION_PICKS)
  sessionPicks = { ...Object.fromEntries(kept), [sessionScope]: pick }
  try {
    SecureStore.setItem(SESSION_PICKS_KEY, JSON.stringify(sessionPicks))
  } catch {
    // Best-effort: the pick still applies until the app restarts.
  }
  for (const listener of listeners) listener()
}

function useSessionPick(sessionScope: string | null): SessionPick | null {
  return useSyncExternalStore(subscribe, () =>
    sessionScope ? (readSessionPicks()[sessionScope] ?? null) : null
  )
}

const pickKey = (harness: SessionHarness, field: "model" | "effort" | "fast") =>
  `${KEY_PREFIX[harness]}.${field}`

// What a session's newest run used, from its reply (any device, any sender).
export type SessionTurnPick = SessionPick

// A session's own picks, or for a session this device never picked in, what
// its newest run used.
export type ModelScope = {
  sessionScope: string
  lastTurn: SessionTurnPick | null
}

export type ModelChoice = {
  harness: SessionHarness
  workspaceSlug: string
  // The session the picks are remembered for; null: the new-session screen.
  sessionScope: string | null
  catalog: AgentModels | undefined
  option: AgentModelOption | undefined
  // null: the harness's default.
  effort: string | null
  fast: boolean
  // What a message sends for its turn.
  turn: Pick<SendMessagePayload, "model" | "effort" | "fast">
}

// A pick changes one of the three; the session keeps the other two as shown.
// It also becomes the person's pick for new sessions.
export function rememberPick(
  choice: ModelChoice,
  change: { model?: string; effort?: string | null; fast?: boolean }
) {
  const { harness, sessionScope } = choice
  const model = change.model ?? choice.option?.id
  if (sessionScope && model) {
    rememberSessionPick(sessionScope, {
      model,
      effort: change.effort !== undefined ? change.effort : choice.effort,
      fast: change.fast ?? choice.fast,
    })
  }
  if (change.model) remember(pickKey(harness, "model"), change.model)
  if (change.effort !== undefined)
    remember(pickKey(harness, "effort"), change.effort)
  if (change.fast !== undefined)
    remember(pickKey(harness, "fast"), change.fast ? "true" : null)
}

// Keeps a session on the picks its message went with, even when the person
// later picks differently elsewhere.
export function pinSessionChoice(choice: ModelChoice) {
  rememberPick(choice, {})
}

// The remembered choice, held to what the catalog offers, as on web.
export function useModelChoice(
  harness: SessionHarness,
  {
    workspaceSlug = "",
    enabled = true,
    scope,
  }: { workspaceSlug?: string; enabled?: boolean; scope?: ModelScope }
): ModelChoice {
  const { data: catalog } = useQuery({
    ...agentModelsQueryOptions(harness, workspaceSlug),
    enabled: enabled && Boolean(workspaceSlug),
  })
  const sessionScope = scope?.sessionScope ?? null
  const savedModel = useRemembered(pickKey(harness, "model"))
  const savedEffort = useRemembered(pickKey(harness, "effort"))
  const savedFast = useRemembered(pickKey(harness, "fast")) === "true"
  const wanted: SessionPick = useSessionPick(sessionScope) ??
    scope?.lastTurn ?? {
      model: savedModel ?? "",
      effort: savedEffort,
      fast: savedFast,
    }
  const option =
    catalog?.models.find((model) => model.id === wanted.model) ??
    catalog?.models.find((model) => model.id === catalog.defaultModel)
  const effort = !option
    ? null
    : ([wanted.effort, catalog?.defaultEffort].find(
        (level): level is string =>
          typeof level === "string" && option.efforts.includes(level)
      ) ?? null)
  const fast = Boolean(option?.fast && wanted.fast)
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

// A session transcript's rows name each Lor reply's model through this; null
// outside a session.
export const RunModelLabelContext = createContext<
  ((model: string) => RunModelLabel) | null
>(null)
