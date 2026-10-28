import { queryOptions, useQuery } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import type { SessionHarness } from "@/components/session/harness-picker"
import { apiClient } from "@/lib/api-client"

// A harness's models for the composer's picker, with each model's effort
// levels and fast mode, read from the harness's own catalog on the server.

async function fetchAgentModels(harness: SessionHarness) {
  const res = await apiClient.v1["agent-models"].$get({ query: { harness } })
  if (!res.ok) throw new Error("Failed to load models")
  return res.json()
}

export type AgentModels = Awaited<ReturnType<typeof fetchAgentModels>>
export type AgentModelOption = AgentModels["models"][number]

export const agentModelsKey = (harness: SessionHarness) =>
  ["agent-models", harness] as const

export const agentModelsQueryOptions = (harness: SessionHarness) =>
  queryOptions({
    queryKey: agentModelsKey(harness),
    queryFn: () => fetchAgentModels(harness),
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

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function useRemembered(key: string) {
  return useSyncExternalStore(subscribe, () => readRemembered(key))
}

export const rememberModel = (harness: SessionHarness, model: string) =>
  remember(`${KEY_PREFIX[harness]}-model`, model)

// null: the harness's default effort.
export const rememberEffort = (
  harness: SessionHarness,
  effort: string | null
) => remember(`${KEY_PREFIX[harness]}-effort`, effort)

export const rememberFast = (harness: SessionHarness, fast: boolean) =>
  remember(`${KEY_PREFIX[harness]}-fast`, fast ? "true" : null)

export type ModelChoice = {
  harness: SessionHarness
  catalog: AgentModels | undefined
  option: AgentModelOption | undefined
  // null: the harness's default.
  effort: string | null
  fast: boolean
  // What a message sends for its turn.
  turn: { model?: string; effort?: string; fast?: boolean }
}

// The remembered choice, held to what the catalog offers: a model it no
// longer lists falls back to its default, an effort the model doesn't take
// to the catalog's default effort. Until the catalog loads, only the
// remembered model is sent.
export function useModelChoice(harness: SessionHarness): ModelChoice {
  const { data: catalog } = useQuery(agentModelsQueryOptions(harness))
  const prefix = KEY_PREFIX[harness]
  const savedModel = useRemembered(`${prefix}-model`)
  const savedEffort = useRemembered(`${prefix}-effort`)
  const savedFast = useRemembered(`${prefix}-fast`) === "true"
  const option =
    catalog?.models.find((model) => model.id === savedModel) ??
    catalog?.models.find((model) => model.id === catalog.defaultModel)
  const effort = !option
    ? null
    : ([savedEffort, catalog?.defaultEffort].find(
        (level): level is string =>
          typeof level === "string" && option.efforts.includes(level)
      ) ?? null)
  const fast = Boolean(option?.fast && savedFast)
  const model = option?.id ?? savedModel ?? undefined
  return {
    harness,
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
}
