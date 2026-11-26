import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import {
  access,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createVertex } from "@ai-sdk/google-vertex"
import { createOpenAI } from "@ai-sdk/openai"
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all"
import {
  loadWorkspaceInferenceKey,
  workspaceInferenceKeyId,
  workspaceInferenceKeyRef,
} from "@repo/db/queries/inference"
import { env } from "@repo/env/server"
import {
  type DirectKeyProvider,
  type InferenceCredential,
  type InferenceFunding,
  type InferenceKeyConfig,
  KEY_PROVIDER_NAMES,
  KEY_PROVIDERS,
  type KeyProvider,
  parseKeyModelId,
} from "@repo/utils/inference"
import { LOR_MODEL } from "./models"

export function isByokModel(provider: KeyProvider, model: string) {
  return getBuiltinModels(provider).some((item) => item.id === model)
}

// Bedrock cross-region inference profiles prefix the model ID with their
// geography ("us.", "eu.", "global."). Newer models only run through one.
const BEDROCK_GEO = /^(us-gov|us|eu|apac|au|jp|in|ca|global)\./

function bedrockGeos(region: string) {
  if (region.startsWith("us-gov-")) return ["us-gov"]
  if (region.startsWith("us-")) return ["us", "global"]
  if (region.startsWith("eu-")) return ["eu", "global"]
  if (region.startsWith("ca-")) return ["ca", "global"]
  if (region === "ap-northeast-1" || region === "ap-northeast-3")
    return ["jp", "apac", "global"]
  if (region === "ap-southeast-2" || region === "ap-southeast-4")
    return ["au", "apac", "global"]
  if (region === "ap-south-1" || region === "ap-south-2")
    return ["in", "apac", "global"]
  if (region.startsWith("ap-")) return ["apac", "global"]
  return ["global"]
}

// Bedrock models a region can call: its geography's inference profiles, plus
// base model IDs that have no profile there (on-demand in-region models).
function bedrockRegionModels(region: string) {
  const geos = bedrockGeos(region)
  const models = getBuiltinModels("amazon-bedrock")
  const geoOf = (id: string) => BEDROCK_GEO.exec(id)?.[1]
  const profiled = new Set(
    models
      .filter((model) => geos.includes(geoOf(model.id) ?? ""))
      .map((model) => model.id.replace(BEDROCK_GEO, ""))
  )
  return models.filter((model) => {
    const geo = geoOf(model.id)
    return geo ? geos.includes(geo) : !profiled.has(model.id)
  })
}

// The Pi catalog models a saved provider runs: Azure only the models it has
// deployments for, Bedrock the ones its region serves, the rest everything.
export function keyModels(config: InferenceKeyConfig) {
  if (config.provider === "azure") {
    const deployed = new Set(config.deployments.map((item) => item.model))
    return getBuiltinModels("azure").filter((model) => deployed.has(model.id))
  }
  if (config.provider === "amazon-bedrock")
    return bedrockRegionModels(config.region)
  return getBuiltinModels(config.provider)
}

// The workspace provider that pays for a "key:<provider>/<model>" composer
// pick, or null when the pick is Lor-paid or its provider or model is gone.
export async function keyFunding(
  workspaceId: string,
  pick: string | undefined
): Promise<Extract<InferenceFunding, { source: "byok" }> | null> {
  const picked = pick ? parseKeyModelId(pick) : null
  if (!picked) return null
  const key = await workspaceInferenceKeyRef(workspaceId, picked.provider)
  if (!key || !keyModels(key.config).some((m) => m.id === picked.model))
    return null
  return { source: "byok", keyId: key.keyId, ...picked }
}

// The provider's list price (USD per million tokens) for a
// "<provider>/<model>" step, from Pi's catalog. Prices the own-key fee.
export function byokPrice(model: string) {
  const slash = model.indexOf("/")
  const provider = KEY_PROVIDERS.find((item) => item === model.slice(0, slash))
  if (!provider) return null
  const id = model.slice(slash + 1)
  const cost = getBuiltinModels(provider).find((item) => item.id === id)?.cost
  if (!cost) return null
  return {
    inputUsdPerMtok: cost.input,
    cachedInputUsdPerMtok: cost.cacheRead || cost.input,
    outputUsdPerMtok: cost.output,
  }
}

export const azureBaseUrl = (endpoint: string) => `${endpoint}/openai/v1`

// Pi reads a Vertex service account key only from a file
// (GOOGLE_APPLICATION_CREDENTIALS). Each key is written once to a private
// temp dir on the worker host, never the sandbox; a workspace's older keys
// are deleted when a new one is written, and the dir on exit.
let vertexDir: Promise<string> | null = null
function vertexKeyDir() {
  vertexDir ??= mkdtemp(join(tmpdir(), "lor-vertex-")).then(
    (dir) => {
      process.once("exit", () => rmSync(dir, { recursive: true, force: true }))
      return dir
    },
    (err: unknown) => {
      // Not cached, so the next run tries again.
      vertexDir = null
      throw err
    }
  )
  return vertexDir
}

async function vertexKeyFile(
  workspaceId: string,
  keyId: string,
  credential: Extract<InferenceCredential, { provider: "google-vertex" }>
) {
  const dir = await vertexKeyDir()
  const name = `${workspaceId}-${keyId}.json`
  const path = join(dir, name)
  if (
    await access(path).then(
      () => true,
      () => false
    )
  )
    return path
  const staging = join(dir, `${randomUUID()}.tmp`)
  await writeFile(
    staging,
    JSON.stringify({
      type: "service_account",
      project_id: credential.project,
      private_key_id: credential.privateKeyId ?? undefined,
      private_key: credential.privateKey,
      client_email: credential.clientEmail,
      token_uri: "https://oauth2.googleapis.com/token",
    }),
    { mode: 0o600 }
  )
  await rename(staging, path)
  for (const file of await readdir(dir)) {
    if (file.startsWith(`${workspaceId}-`) && file !== name)
      await rm(join(dir, file), { force: true })
  }
  return path
}

// The env Pi's provider reads its credentials from. Kept in the worker's
// in-memory Pi transport, never in tool context or sandbox files.
async function piAuth(
  workspaceId: string,
  keyId: string,
  credential: InferenceCredential
): Promise<Record<string, string>> {
  switch (credential.provider) {
    case "anthropic":
      return { ANTHROPIC_API_KEY: credential.apiKey }
    case "openai":
      return { OPENAI_API_KEY: credential.apiKey }
    case "azure":
      return {
        AZURE_OPENAI_API_KEY: credential.apiKey,
        AZURE_OPENAI_BASE_URL: azureBaseUrl(credential.endpoint),
        AZURE_OPENAI_DEPLOYMENT_NAME_MAP: credential.deployments
          .map((item) => `${item.model}=${item.deployment}`)
          .join(","),
      }
    case "google-vertex":
      return {
        GOOGLE_CLOUD_PROJECT: credential.project,
        GOOGLE_CLOUD_LOCATION: credential.location,
        GOOGLE_APPLICATION_CREDENTIALS: await vertexKeyFile(
          workspaceId,
          keyId,
          credential
        ),
      }
    case "amazon-bedrock":
      if (credential.auth.method === "api_key")
        return {
          AWS_REGION: credential.region,
          AWS_BEARER_TOKEN_BEDROCK: credential.auth.apiKey,
        }
      // Pi reads a value the scoped env leaves unset from the worker's own
      // env: its bearer token would replace the workspace's IAM keys, and its
      // session token would be signed in with them.
      for (const name of ["AWS_BEARER_TOKEN_BEDROCK", "AWS_SESSION_TOKEN"])
        if (process.env[name])
          throw new Error(
            `${name} is set on this worker, so a workspace's Bedrock IAM keys can't be used safely. Unset it.`
          )
      return {
        AWS_REGION: credential.region,
        AWS_ACCESS_KEY_ID: credential.auth.accessKeyId,
        AWS_SECRET_ACCESS_KEY: credential.auth.secretAccessKey,
      }
  }
}

export async function nativeInference(
  workspaceId: string,
  funding: Extract<InferenceFunding, { source: "byok" }>
) {
  const credential = await loadWorkspaceInferenceKey(workspaceId, funding)
  return {
    provider: funding.provider,
    model: funding.model,
    auth: await piAuth(workspaceId, funding.keyId, credential),
    credential,
  }
}

// A missing or unusable workspace key or model setting; the message tells the
// person what to update.
export class InferenceConfigError extends Error {}

// LOR_MODEL is provider-neutral (DeepSeek by default), so Claude Code API
// turns use it only when it is a Claude model.
export const CLAUDE_API_DEFAULT_MODEL = LOR_MODEL.startsWith("anthropic/")
  ? LOR_MODEL.slice("anthropic/".length)
  : "claude-opus-5-5"

export async function harnessApiFunding(
  workspaceId: string,
  provider: DirectKeyProvider,
  billing: "lor" | "byok",
  pick: string | undefined,
  defaultModel: string
): Promise<InferenceFunding> {
  const raw = pick?.replace(/^(?:key:)?(?:anthropic|openai)\//, "")
  const model = raw && isByokModel(provider, raw) ? raw : defaultModel
  if (billing === "byok") {
    const keyId = await workspaceInferenceKeyId(workspaceId, provider)
    if (!keyId)
      throw new InferenceConfigError(
        `The workspace's ${KEY_PROVIDER_NAMES[provider]} API key is missing. Update Workspace settings → AI providers.`
      )
    return { source: "byok", keyId, provider, model }
  }
  return { source: "lor", model: `${provider}/${model}` }
}

// The AI SDK model for turns outside Pi (channel agents, post-answer work).
export function nativeLanguageModel(
  native: Awaited<ReturnType<typeof nativeInference>>
) {
  const credential = native.credential
  switch (credential.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: credential.apiKey }).languageModel(
        native.model
      )
    case "openai":
      return createOpenAI({ apiKey: credential.apiKey }).responses(native.model)
    case "azure": {
      const deployment =
        credential.deployments.find((item) => item.model === native.model)
          ?.deployment ?? native.model
      return createAzure({
        baseURL: azureBaseUrl(credential.endpoint),
        apiKey: credential.apiKey,
      }).responses(deployment)
    }
    case "google-vertex":
      return createVertex({
        project: credential.project,
        location: credential.location,
        googleAuthOptions: {
          credentials: {
            client_email: credential.clientEmail,
            private_key: credential.privateKey,
          },
        },
      })(native.model)
    case "amazon-bedrock": {
      const auth = credential.auth
      return createAmazonBedrock(
        auth.method === "api_key"
          ? { region: credential.region, apiKey: auth.apiKey }
          : {
              region: credential.region,
              // Empty, not unset: unset falls back to the worker's own
              // AWS_BEARER_TOKEN_BEDROCK, which would win over SigV4.
              apiKey: "",
              // Not the access key fields: those fall back to the worker's
              // own AWS_* env (a session token) when unset.
              credentialProvider: async () => ({
                accessKeyId: auth.accessKeyId,
                secretAccessKey: auth.secretAccessKey,
              }),
            }
      )(native.model)
    }
  }
}

export function harnessApiConnection(
  provider: DirectKeyProvider,
  funding: InferenceFunding | undefined,
  native: Awaited<ReturnType<typeof nativeInference>> | null
) {
  const apiKey =
    native?.credential.provider === "anthropic" ||
    native?.credential.provider === "openai"
      ? native.credential.apiKey
      : null
  return {
    token: native ? (apiKey ?? "") : env.AI_GATEWAY_API_KEY,
    gateway: !native,
    baseUrl: native
      ? provider === "anthropic"
        ? "https://api.anthropic.com"
        : "https://api.openai.com/v1"
      : `${(env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1").replace(/\/v1\/?$/, "").replace(/\/$/, "")}/${provider === "anthropic" ? "claude-code" : "codex/v1"}`,
    model: native?.model ?? funding?.model,
  }
}
