export const KEY_PROVIDERS = ["anthropic", "openai"] as const
export type KeyProvider = (typeof KEY_PROVIDERS)[number]

// Who pays for a Lor turn, pinned on its agent run across retries.
export type InferenceFunding =
  | { source: "lor"; model: string }
  | {
      source: "byok"
      keyId: string
      provider: KeyProvider
      // The provider's own model ID, e.g. "claude-sonnet-4-5".
      model: string
    }

// A composer pick paid by the workspace's own provider key, e.g.
// "key:anthropic/claude-sonnet-4-5". Lor-paid picks are AI Gateway slugs.
export const keyModelId = (provider: KeyProvider, model: string) =>
  `key:${provider}/${model}`

export function parseKeyModelId(id: string) {
  const match = /^key:(anthropic|openai)\/(.+)$/.exec(id)
  const provider = KEY_PROVIDERS.find((item) => item === match?.[1])
  return provider && match?.[2] ? { provider, model: match[2] } : null
}

// What the composer sends for the model a funding runs.
export const fundedModelId = (funding: InferenceFunding) =>
  funding.source === "byok"
    ? keyModelId(funding.provider, funding.model)
    : funding.model
