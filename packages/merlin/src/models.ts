import { createGateway } from "@ai-sdk/gateway"
import { MERLIN_EMBED_DIMENSIONS } from "@repo/db/constants"
import { env } from "@repo/env/server"

function parseFallbacks(value: string): string[] {
  return value
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)
}

function createTransport(options: { baseURL?: string; apiKey: string }) {
  return createGateway({
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    apiKey: options.apiKey,
  })
}

if (env.MERLIN_EMBED_DIMENSIONS !== MERLIN_EMBED_DIMENSIONS) {
  throw new Error(
    `MERLIN_EMBED_DIMENSIONS=${env.MERLIN_EMBED_DIMENSIONS} does not match the compiled database schema (${MERLIN_EMBED_DIMENSIONS}); change the schema and re-embed before changing dimensions`
  )
}

// The one resolved configuration boundary for every Merlin model role and
// transport concern. Keep it private so credentials cannot be imported or
// accidentally logged by consumers.
const modelConfig = {
  gateway: {
    baseURL: env.AI_GATEWAY_BASE_URL,
    apiKey: env.AI_GATEWAY_API_KEY,
  },
  main: {
    id: env.MERLIN_MODEL,
    fallbacks: parseFallbacks(env.MERLIN_MODEL_FALLBACKS),
  },
  small: {
    id: env.MERLIN_SMALL_MODEL,
    fallbacks: parseFallbacks(env.MERLIN_SMALL_MODEL_FALLBACKS),
  },
  embedding: {
    id: env.MERLIN_EMBED_MODEL,
    dimensions: MERLIN_EMBED_DIMENSIONS,
  },
} as const

const gatewayTransport = createTransport(modelConfig.gateway)

// Backwards-compatible ids for logging and consumers that display the
// requested model. Calls use the resolved model objects below.
export const MERLIN_MODEL = modelConfig.main.id
export const MERLIN_FALLBACK_MODELS = modelConfig.main.fallbacks
export const MERLIN_SMALL_MODEL = modelConfig.small.id
export const MERLIN_SMALL_FALLBACK_MODELS = modelConfig.small.fallbacks
export const MERLIN_EMBED_MODEL = modelConfig.embedding.id
export const MERLIN_EMBED_DIM = modelConfig.embedding.dimensions

export const merlinModel = gatewayTransport.languageModel(MERLIN_MODEL)
export const merlinSmallModel =
  gatewayTransport.languageModel(MERLIN_SMALL_MODEL)
export const merlinEmbeddingModel =
  gatewayTransport.textEmbeddingModel(MERLIN_EMBED_MODEL)

export const mainGatewayOptions = {
  caching: "auto" as const,
  models: MERLIN_FALLBACK_MODELS,
}

export const smallGatewayOptions = {
  models: MERLIN_SMALL_FALLBACK_MODELS,
}
