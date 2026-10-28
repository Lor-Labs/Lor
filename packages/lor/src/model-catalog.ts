import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models"
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all"
import { LOR_FALLBACK_MODELS, LOR_MODEL } from "./models"
import { CODEX_DEFAULT_MODEL } from "./session-core/codex-runtime"

// What a session's composer offers for its harness: each model the harness
// can run, the effort levels that model takes and whether it has fast mode.
// Read from the harness's own catalog, so no per-model list is kept here.

export type AgentModelOption = {
  // What a message sends as its model.
  id: string
  name: string
  // The vendor, to group a long list ("anthropic", "openai"); null in a
  // harness with one vendor.
  provider: string | null
  // Effort levels the model takes, lowest first; empty: none to pick.
  efforts: string[]
  // Fast mode is for subscription harnesses only.
  fast: boolean
}

export type AgentModelCatalog = {
  models: AgentModelOption[]
  defaultModel: string
  // Used when the model takes it; null: the harness's own default.
  defaultEffort: string | null
}

export type CatalogHarness = "pi" | "claude_code" | "codex"

const GATEWAY_PROVIDER = "vercel-ai-gateway"

// Lor's own agent: every chat model in Pi's AI Gateway catalog (generated
// from models.dev), with the thinking levels Pi maps for each. Lor's main
// model and its fallbacks come first. The catalog's "-fast" models are fast
// mode, which Lor's agent doesn't offer.
function lorCatalog(): AgentModelCatalog {
  const pinned = [LOR_MODEL, ...LOR_FALLBACK_MODELS]
  const rank = (id: string) => {
    const at = pinned.indexOf(id)
    return at === -1 ? pinned.length : at
  }
  const models = getBuiltinModels(GATEWAY_PROVIDER)
    .filter((model) => !model.id.endsWith("-fast"))
    .map((model) => {
      const levels = getSupportedThinkingLevels(model)
      return {
        id: model.id,
        name: model.name,
        provider: model.id.split("/")[0] ?? null,
        efforts: levels.length > 1 ? levels : [],
        fast: false,
      }
    })
    .sort(
      (a, b) =>
        rank(a.id) - rank(b.id) ||
        (a.provider ?? "").localeCompare(b.provider ?? "") ||
        a.name.localeCompare(b.name)
    )
  return { models, defaultModel: LOR_MODEL, defaultEffort: "high" }
}

// Until a turn reports Claude Code's own list for the person (their account
// decides it), its model aliases, with no effort or fast choice yet.
const CLAUDE_CODE_ALIASES = [
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
  ["fable", "Fable"],
] as const

// Until Codex's own model/list is read, the models Codex sessions offered.
const CODEX_MODELS = [
  ["gpt-6.1-sol", "GPT-6.1 Sol"],
  ["gpt-6-astra", "GPT-6 Astra"],
  ["gpt-6-luna", "GPT-6 Luna"],
] as const

function namedOnly(
  list: readonly (readonly [string, string])[]
): AgentModelOption[] {
  return list.map(([id, name]) => ({
    id,
    name,
    provider: null,
    efforts: [],
    fast: false,
  }))
}

export function agentModelCatalog(harness: CatalogHarness): AgentModelCatalog {
  if (harness === "claude_code") {
    return {
      models: namedOnly(CLAUDE_CODE_ALIASES),
      defaultModel: "opus",
      defaultEffort: null,
    }
  }
  if (harness === "codex") {
    return {
      models: namedOnly(CODEX_MODELS),
      defaultModel: CODEX_DEFAULT_MODEL,
      defaultEffort: null,
    }
  }
  return lorCatalog()
}
