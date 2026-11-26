// Workspace AI providers (BYOK). IDs match Pi's provider catalog names, so a
// saved provider's models come straight from `getBuiltinModels(provider)`.
export const KEY_PROVIDERS = [
  "anthropic",
  "openai",
  "azure",
  "google-vertex",
  "amazon-bedrock",
] as const
export type KeyProvider = (typeof KEY_PROVIDERS)[number]
// Plain API keys. Claude Code and Codex API billing only ever use these.
export type DirectKeyProvider = Extract<KeyProvider, "anthropic" | "openai">
export const KEY_PROVIDER_NAMES: Record<KeyProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  azure: "Azure OpenAI",
  "google-vertex": "Google Vertex AI",
  "amazon-bedrock": "AWS Bedrock",
}
// Who pays for a key-paid model, as the composer and settings label it.
export const KEY_PROVIDER_PAYERS: Record<KeyProvider, string> = {
  anthropic: "Anthropic key",
  openai: "OpenAI key",
  azure: "Azure OpenAI",
  "google-vertex": "Google Vertex AI",
  "amazon-bedrock": "AWS Bedrock",
}

export type AzureDeployment = {
  // Pi's catalog ID for the model, e.g. "gpt-5".
  model: string
  // The deployment name in the Azure resource, sent as the request's model.
  deployment: string
}

export type BedrockAuthMethod = "access_key" | "api_key"

// A saved provider's full credential, encrypted at rest. Server only.
export type InferenceCredential =
  | { provider: "anthropic" | "openai"; apiKey: string }
  | {
      provider: "azure"
      endpoint: string
      apiKey: string
      deployments: AzureDeployment[]
    }
  | {
      provider: "google-vertex"
      project: string
      location: string
      clientEmail: string
      privateKey: string
      privateKeyId: string | null
    }
  | {
      provider: "amazon-bedrock"
      region: string
      auth:
        | { method: "access_key"; accessKeyId: string; secretAccessKey: string }
        | { method: "api_key"; apiKey: string }
    }

// The non-secret part of a saved credential, shown in settings and used to
// list the models it can run.
export type InferenceKeyConfig =
  | { provider: "anthropic" | "openai" }
  | { provider: "azure"; endpoint: string; deployments: AzureDeployment[] }
  | {
      provider: "google-vertex"
      project: string
      location: string
      clientEmail: string
    }
  | {
      provider: "amazon-bedrock"
      region: string
      authMethod: BedrockAuthMethod
      // The access key ID (not secret) when signing with IAM keys.
      accessKeyId: string | null
    }

export function inferenceKeyConfig(
  credential: InferenceCredential
): InferenceKeyConfig {
  switch (credential.provider) {
    case "anthropic":
    case "openai":
      return { provider: credential.provider }
    case "azure":
      return {
        provider: "azure",
        endpoint: credential.endpoint,
        deployments: credential.deployments,
      }
    case "google-vertex":
      return {
        provider: "google-vertex",
        project: credential.project,
        location: credential.location,
        clientEmail: credential.clientEmail,
      }
    case "amazon-bedrock":
      return {
        provider: "amazon-bedrock",
        region: credential.region,
        authMethod: credential.auth.method,
        accessKeyId:
          credential.auth.method === "access_key"
            ? credential.auth.accessKeyId
            : null,
      }
  }
}

// The last four characters of the key people recognize it by (an AWS access
// key ID, a service account's key ID), to tell keys apart.
export function inferenceKeyHint(credential: InferenceCredential) {
  const key =
    credential.provider === "google-vertex"
      ? (credential.privateKeyId ?? credential.clientEmail)
      : credential.provider === "amazon-bedrock"
        ? credential.auth.method === "access_key"
          ? credential.auth.accessKeyId
          : credential.auth.apiKey
        : credential.apiKey
  return key.slice(-4)
}

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

// A composer pick paid by the workspace's own provider, e.g.
// "key:anthropic/claude-sonnet-4-5" or
// "key:amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0".
// Lor-paid picks are AI Gateway slugs.
export const keyModelId = (provider: KeyProvider, model: string) =>
  `key:${provider}/${model}`

export function parseKeyModelId(id: string) {
  const match = /^key:([a-z-]+)\/(.+)$/.exec(id)
  const provider = KEY_PROVIDERS.find((item) => item === match?.[1])
  return provider && match?.[2] ? { provider, model: match[2] } : null
}

// What the composer sends for the model a funding runs.
export const fundedModelId = (funding: InferenceFunding) =>
  funding.source === "byok"
    ? keyModelId(funding.provider, funding.model)
    : funding.model

// The model a channel's always-on agent runs on until the channel picks one
// (reference/always-on-agents.md, decision 15).
export const CHANNEL_AGENT_DEFAULT_MODEL = "anthropic/claude-opus-5.5"
