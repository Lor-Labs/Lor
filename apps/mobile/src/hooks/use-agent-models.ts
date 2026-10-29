import type { SendMessagePayload } from "@repo/realtime-types"
import { queryOptions, useQuery } from "@tanstack/react-query"
import * as SecureStore from "expo-secure-store"
import { useSyncExternalStore } from "react"
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

export const rememberModel = (harness: SessionHarness, model: string) =>
  remember(`${KEY_PREFIX[harness]}.model`, model)

// null: the harness's default effort.
export const rememberEffort = (
  harness: SessionHarness,
  effort: string | null
) => remember(`${KEY_PREFIX[harness]}.effort`, effort)

export const rememberFast = (harness: SessionHarness, fast: boolean) =>
  remember(`${KEY_PREFIX[harness]}.fast`, fast ? "true" : null)

export type ModelChoice = {
  harness: SessionHarness
  workspaceSlug: string
  catalog: AgentModels | undefined
  option: AgentModelOption | undefined
  // null: the harness's default.
  effort: string | null
  fast: boolean
  // What a message sends for its turn.
  turn: Pick<SendMessagePayload, "model" | "effort" | "fast">
}

// The remembered choice, held to what the catalog offers, as on web.
export function useModelChoice(
  harness: SessionHarness,
  enabled = true,
  workspaceSlug = ""
): ModelChoice {
  const { data: catalog } = useQuery({
    ...agentModelsQueryOptions(harness, workspaceSlug),
    enabled: enabled && Boolean(workspaceSlug),
  })
  const prefix = KEY_PREFIX[harness]
  const savedModel = useRemembered(`${prefix}.model`)
  const savedEffort = useRemembered(`${prefix}.effort`)
  const savedFast = useRemembered(`${prefix}.fast`) === "true"
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
  const model = option?.id
  return {
    harness,
    workspaceSlug,
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
