import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all"
import {
  loadWorkspaceInferenceKey,
  workspaceInferenceKeyId,
} from "@repo/db/queries/inference"
import {
  type InferenceFunding,
  KEY_PROVIDER_NAMES,
  type KeyProvider,
  parseKeyModelId,
} from "@repo/utils/inference"

export function isByokModel(provider: KeyProvider, model: string) {
  return getBuiltinModels(provider).some((item) => item.id === model)
}

// The workspace key that pays for a "key:<provider>/<model>" composer pick,
// or null when the pick is Lor-paid or its key or model is gone.
export async function keyFunding(
  workspaceId: string,
  pick: string | undefined
): Promise<Extract<InferenceFunding, { source: "byok" }> | null> {
  const picked = pick ? parseKeyModelId(pick) : null
  if (!picked || !isByokModel(picked.provider, picked.model)) return null
  const keyId = await workspaceInferenceKeyId(workspaceId, picked.provider)
  return keyId ? { source: "byok", keyId, ...picked } : null
}

// The provider's list price (USD per million tokens) for a
// "<provider>/<model>" step, from Pi's catalog. Prices the own-key fee.
export function byokPrice(model: string) {
  const slash = model.indexOf("/")
  const provider = model.slice(0, slash)
  if (provider !== "anthropic" && provider !== "openai") return null
  const id = model.slice(slash + 1)
  const cost = getBuiltinModels(provider).find((item) => item.id === id)?.cost
  if (!cost) return null
  return {
    inputUsdPerMtok: cost.input,
    cachedInputUsdPerMtok: cost.cacheRead || cost.input,
    outputUsdPerMtok: cost.output,
  }
}

// Saving a key lists the provider's models with it: free, and a bad or
// under-scoped key fails here instead of on a run. Returns the provider's
// error, or null when the key works.
export async function verifyProviderKey(provider: KeyProvider, apiKey: string) {
  const name = KEY_PROVIDER_NAMES[provider]
  const res = await fetch(
    provider === "anthropic"
      ? "https://api.anthropic.com/v1/models"
      : "https://api.openai.com/v1/models",
    {
      headers:
        provider === "anthropic"
          ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
          : { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    }
  ).catch(() => null)
  if (!res) return `Couldn't reach ${name}. Try again.`
  if (res.ok) return null
  const body: { error?: { message?: unknown } } | null = await res
    .json()
    .catch(() => null)
  const message = body?.error?.message
  return typeof message === "string" && message
    ? `${name}: ${message}`
    : `${name} rejected this key (${res.status}).`
}

// These credentials stay in the worker's in-memory Pi transport, never in tool context or sandbox files.
export async function nativeInference(
  workspaceId: string,
  funding: Extract<InferenceFunding, { source: "byok" }>
) {
  const apiKey = await loadWorkspaceInferenceKey(workspaceId, funding)
  const auth: Record<string, string> =
    funding.provider === "anthropic"
      ? { ANTHROPIC_API_KEY: apiKey }
      : { OPENAI_API_KEY: apiKey }
  return { provider: funding.provider, model: funding.model, auth }
}
