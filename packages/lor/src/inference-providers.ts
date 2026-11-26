import { createSign } from "node:crypto"
import {
  BedrockClient,
  ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock"
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all"
import {
  type AzureDeployment,
  type InferenceCredential,
  KEY_PROVIDER_NAMES,
} from "@repo/utils/inference"
import { azureBaseUrl } from "./byok"

// Workspace settings → AI providers: what a person enters for each provider,
// turned into the stored credential, and a check with the provider before
// it is saved. See reference/beta-pricing-runbook.md (BYOK).

// Secrets are optional when the provider is already saved: a blank field
// keeps the saved value, so changing a region or deployment needs no re-paste.
export type InferenceCredentialInput =
  | { provider: "anthropic" | "openai"; apiKey: string }
  | {
      provider: "azure"
      endpoint: string
      apiKey?: string
      deployments: AzureDeployment[]
    }
  | {
      provider: "google-vertex"
      serviceAccountKey?: string
      project?: string
      location: string
    }
  | {
      provider: "amazon-bedrock"
      region: string
      authMethod: "access_key" | "api_key"
      accessKeyId?: string
      secretAccessKey?: string
      apiKey?: string
    }

type Parsed = { credential: InferenceCredential } | { error: string }

// An edit that left its secret blank, so it keeps the saved one.
export function reusesSavedSecret(input: InferenceCredentialInput) {
  switch (input.provider) {
    case "anthropic":
    case "openai":
      return false
    case "azure":
      return !input.apiKey?.trim()
    case "google-vertex":
      return !input.serviceAccountKey?.trim()
    case "amazon-bedrock":
      return input.authMethod === "api_key"
        ? !input.apiKey?.trim()
        : !input.secretAccessKey?.trim()
  }
}

// Models an Azure deployment can serve, for the settings deployment picker.
export const AZURE_MODELS = getBuiltinModels("azure")
  .map((model) => ({ id: model.id, name: model.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

// Azure OpenAI and AI Foundry resource hosts. Anything else is refused, so
// the save check never fetches an arbitrary URL.
const AZURE_HOSTS = [
  ".openai.azure.com",
  ".cognitiveservices.azure.com",
  ".services.ai.azure.com",
]

export function azureEndpoint(raw: string) {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.port) return null
  return AZURE_HOSTS.some((host) => url.hostname.endsWith(host))
    ? url.origin
    : null
}

const AWS_REGION = /^[a-z]{2}(-gov)?-[a-z]+-\d$/
const GCP_LOCATION = /^(global|[a-z]+-[a-z]+\d+)$/
const GCP_PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
const AZURE_DEPLOYMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function serviceAccount(text: string) {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof json !== "object" || json === null) return null
  const field = (name: string) => {
    const value = (json as Record<string, unknown>)[name]
    return typeof value === "string" && value ? value : null
  }
  const clientEmail = field("client_email")
  const privateKey = field("private_key")
  if (field("type") !== "service_account" || !clientEmail || !privateKey)
    return null
  return {
    clientEmail,
    privateKey,
    privateKeyId: field("private_key_id"),
    projectId: field("project_id"),
  }
}

export function parseInferenceCredential(
  input: InferenceCredentialInput,
  saved: InferenceCredential | null
): Parsed {
  const blank = (value: string | undefined) => !value?.trim()
  switch (input.provider) {
    case "anthropic":
    case "openai": {
      const apiKey = input.apiKey.trim()
      const native =
        input.provider === "anthropic"
          ? /^sk-ant-api\S+$/.test(apiKey)
          : /^sk-(?!ant-)\S+$/.test(apiKey)
      if (!native)
        return {
          error:
            "Use an API key from the provider's console. Subscription tokens are not supported.",
        }
      return { credential: { provider: input.provider, apiKey } }
    }
    case "azure": {
      const endpoint = azureEndpoint(input.endpoint)
      if (!endpoint)
        return {
          error:
            "Use your resource's endpoint, like https://my-resource.openai.azure.com.",
        }
      const previous = saved?.provider === "azure" ? saved : null
      const apiKey = blank(input.apiKey)
        ? previous?.apiKey
        : input.apiKey?.trim()
      if (!apiKey) return { error: "Enter the resource's API key." }
      const catalog = new Set(AZURE_MODELS.map((model) => model.id))
      const deployments = input.deployments.map((item) => ({
        model: item.model,
        deployment: item.deployment.trim(),
      }))
      if (deployments.length === 0)
        return { error: "Add at least one deployment." }
      for (const item of deployments) {
        if (!catalog.has(item.model))
          return { error: `${item.model} isn't a model Lor can run on Azure.` }
        if (!AZURE_DEPLOYMENT.test(item.deployment))
          return {
            error: `"${item.deployment}" isn't a valid deployment name.`,
          }
      }
      if (
        new Set(deployments.map((item) => item.model)).size !==
        deployments.length
      )
        return { error: "Each model can have one deployment." }
      return {
        credential: { provider: "azure", endpoint, apiKey, deployments },
      }
    }
    case "google-vertex": {
      const previous = saved?.provider === "google-vertex" ? saved : null
      let key: ReturnType<typeof serviceAccount> = previous
        ? {
            clientEmail: previous.clientEmail,
            privateKey: previous.privateKey,
            privateKeyId: previous.privateKeyId,
            projectId: previous.project,
          }
        : null
      if (!blank(input.serviceAccountKey)) {
        key = serviceAccount(input.serviceAccountKey ?? "")
        if (!key)
          return {
            error:
              "Paste the service account's JSON key file, as downloaded from Google Cloud.",
          }
      }
      if (!key) return { error: "Add a service account key." }
      const project = input.project?.trim() || key.projectId
      if (!project || !GCP_PROJECT.test(project))
        return { error: "Enter a valid Google Cloud project ID." }
      const location = input.location.trim()
      if (!GCP_LOCATION.test(location))
        return { error: "Choose a Vertex AI region, like us-central1." }
      return {
        credential: {
          provider: "google-vertex",
          project,
          location,
          clientEmail: key.clientEmail,
          privateKey: key.privateKey,
          privateKeyId: key.privateKeyId,
        },
      }
    }
    case "amazon-bedrock": {
      const region = input.region.trim()
      if (!AWS_REGION.test(region))
        return { error: "Choose an AWS region, like us-east-1." }
      const previous = saved?.provider === "amazon-bedrock" ? saved.auth : null
      if (input.authMethod === "api_key") {
        const apiKey = blank(input.apiKey)
          ? previous?.method === "api_key"
            ? previous.apiKey
            : undefined
          : input.apiKey?.trim()
        if (!apiKey) return { error: "Enter a Bedrock API key." }
        return {
          credential: {
            provider: "amazon-bedrock",
            region,
            auth: { method: "api_key", apiKey },
          },
        }
      }
      const accessKeyId = input.accessKeyId?.trim() ?? ""
      if (!/^AKIA[A-Z0-9]{12,}$/.test(accessKeyId))
        return {
          error:
            "Use a long-term access key ID (it starts with AKIA). Temporary credentials expire.",
        }
      const secretAccessKey = blank(input.secretAccessKey)
        ? previous?.method === "access_key" &&
          previous.accessKeyId === accessKeyId
          ? previous.secretAccessKey
          : undefined
        : input.secretAccessKey?.trim()
      if (!secretAccessKey) return { error: "Enter the secret access key." }
      return {
        credential: {
          provider: "amazon-bedrock",
          region,
          auth: { method: "access_key", accessKeyId, secretAccessKey },
        },
      }
    }
  }
}

const TIMEOUT_MS = 10_000

async function providerError(res: Response, name: string) {
  const body: unknown = await res.json().catch(() => null)
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? body.error
      : null
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? error.message
      : typeof error === "string"
        ? error
        : null
  return typeof message === "string" && message
    ? `${name}: ${message}`
    : `${name} rejected these credentials (${res.status}).`
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

// A service account's OAuth token, minted with its private key (the JWT
// bearer grant), so the check needs no Google client library.
async function googleAccessToken(clientEmail: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000)
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 600,
  })}`
  let signature: string
  try {
    signature = createSign("RSA-SHA256")
      .update(unsigned)
      .sign(privateKey)
      .toString("base64url")
  } catch {
    return { error: "The service account key's private key is invalid." }
  }
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null)
  if (!res) return { error: "Couldn't reach Google Cloud. Try again." }
  const body: { access_token?: unknown; error_description?: unknown } | null =
    await res.json().catch(() => null)
  if (res.ok && typeof body?.access_token === "string")
    return { token: body.access_token }
  return {
    error:
      typeof body?.error_description === "string"
        ? `Google Cloud: ${body.error_description}`
        : "Google Cloud rejected the service account key.",
  }
}

// Saving checks the credential with the provider using free calls (listing
// models, counting tokens, requests the provider rejects before running), so
// a bad key, endpoint, deployment, region or project fails here instead of on
// a run. A notice saves anyway but says what couldn't be confirmed.
export async function verifyInferenceCredential(
  credential: InferenceCredential
): Promise<{ error: string } | { notice: string | null }> {
  const name = KEY_PROVIDER_NAMES[credential.provider]
  const ok = { notice: null }
  switch (credential.provider) {
    case "anthropic":
    case "openai": {
      const anthropic = credential.provider === "anthropic"
      const res = await fetch(
        anthropic
          ? "https://api.anthropic.com/v1/models"
          : "https://api.openai.com/v1/models",
        {
          headers: anthropic
            ? {
                "x-api-key": credential.apiKey,
                "anthropic-version": "2023-06-01",
              }
            : { authorization: `Bearer ${credential.apiKey}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }
      ).catch(() => null)
      if (!res) return { error: `Couldn't reach ${name}. Try again.` }
      return res.ok ? ok : { error: await providerError(res, name) }
    }
    case "azure": {
      const base = azureBaseUrl(credential.endpoint)
      const res = await fetch(`${base}/models`, {
        headers: { "api-key": credential.apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => null)
      if (!res)
        return {
          error: "Couldn't reach this Azure endpoint. Check the resource name.",
        }
      if (res.status === 404)
        return {
          error: "Azure didn't find an OpenAI resource at this endpoint.",
        }
      if (!res.ok) return { error: await providerError(res, name) }
      // An API key can't list deployments. A request with max_output_tokens
      // below the minimum is refused before it runs, but a missing
      // deployment answers DeploymentNotFound first.
      const missing = await Promise.all(
        credential.deployments.map(async ({ deployment }) => {
          const probe = await fetch(`${base}/responses`, {
            method: "POST",
            headers: {
              "api-key": credential.apiKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: deployment,
              input: "ping",
              max_output_tokens: 1,
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }).catch(() => null)
          if (probe?.status !== 404) return null
          const body: { error?: { code?: unknown } } | null = await probe
            .json()
            .catch(() => null)
          return body?.error?.code === "DeploymentNotFound" ? deployment : null
        })
      )
      const unknown = missing.filter((item) => item !== null)
      return unknown.length > 0
        ? {
            error: `This Azure resource has no deployment named ${unknown.join(", ")}.`,
          }
        : ok
    }
    case "google-vertex": {
      const minted = await googleAccessToken(
        credential.clientEmail,
        credential.privateKey
      )
      if ("error" in minted)
        return { error: minted.error ?? "Google Cloud rejected the key." }
      const host =
        credential.location === "global"
          ? "aiplatform.googleapis.com"
          : `${credential.location}-aiplatform.googleapis.com`
      // countTokens is free and needs the same Vertex AI access as a run. A
      // model the region doesn't serve answers 404, so the next one is tried.
      const models = getBuiltinModels("google-vertex").map((model) => model.id)
      for (const model of [
        "gemini-2.5-flash",
        ...models.filter((id) => id !== "gemini-2.5-flash"),
      ]) {
        const res = await fetch(
          `https://${host}/v1/projects/${credential.project}/locations/${credential.location}/publishers/google/models/${model}:countTokens`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${minted.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: "ping" }] }],
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }
        ).catch(() => null)
        if (!res)
          return {
            error: "Couldn't reach Vertex AI in this region. Try again.",
          }
        if (res.ok) return ok
        if (res.status !== 404) return { error: await providerError(res, name) }
      }
      return {
        error: `Vertex AI in ${credential.location} serves none of the Gemini models Lor runs. Try global or us-central1.`,
      }
    }
    case "amazon-bedrock": {
      const auth = credential.auth
      const client = new BedrockClient({
        region: credential.region,
        maxAttempts: 1,
        requestHandler: { requestTimeout: TIMEOUT_MS },
        ...(auth.method === "api_key"
          ? {
              token: { token: auth.apiKey },
              authSchemePreference: ["httpBearerAuth"],
            }
          : {
              credentials: {
                accessKeyId: auth.accessKeyId,
                secretAccessKey: auth.secretAccessKey,
              },
            }),
      })
      try {
        await client.send(
          new ListFoundationModelsCommand({ byOutputModality: "TEXT" })
        )
        return ok
      } catch (err) {
        // Signed in, but a policy scoped to invoking models can't list them:
        // saved, without claiming model access was checked.
        if (err instanceof Error && err.name === "AccessDeniedException")
          return {
            notice:
              "Saved. AWS accepted these credentials but didn't allow listing models, so access to each model isn't confirmed. A model this key can't call fails when it runs.",
          }
        return {
          error:
            err instanceof Error && err.message
              ? `${name}: ${err.message}`
              : `${name} rejected these credentials.`,
        }
      } finally {
        client.destroy()
      }
    }
  }
}
