import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all"
import { loadWorkspaceInferenceKey } from "@repo/db/queries/inference"
import type { InferenceFunding } from "@repo/utils/inference"

export function byokModels() {
  return (["anthropic", "openai"] as const).flatMap((provider) =>
    getBuiltinModels(provider).map((model) => ({
      provider,
      id: model.id,
      name: model.name,
    }))
  )
}

export function isByokModel(provider: "anthropic" | "openai", model: string) {
  return getBuiltinModels(provider).some((item) => item.id === model)
}

export function assertByokModel(
  provider: "anthropic" | "openai",
  model: string
) {
  if (!isByokModel(provider, model))
    throw new Error("Choose a model supported by this provider")
}

// These credentials stay in the worker's in-memory Pi transport, never in tool context or sandbox files.
export async function nativeInference(
  workspaceId: string,
  funding: Extract<InferenceFunding, { source: "byok" }>
) {
  assertByokModel(funding.provider, funding.model)
  const apiKey = await loadWorkspaceInferenceKey(workspaceId, funding)
  const auth: Record<string, string> =
    funding.provider === "anthropic"
      ? { ANTHROPIC_API_KEY: apiKey }
      : { OPENAI_API_KEY: apiKey }
  return { provider: funding.provider, model: funding.model, auth }
}
