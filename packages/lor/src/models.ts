import { createGateway } from "@ai-sdk/gateway"
import { LOR_EMBED_DIMENSIONS } from "@repo/db/constants"
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

if (env.LOR_EMBED_DIMENSIONS !== LOR_EMBED_DIMENSIONS) {
  throw new Error(
    `LOR_EMBED_DIMENSIONS=${env.LOR_EMBED_DIMENSIONS} does not match the compiled database schema (${LOR_EMBED_DIMENSIONS}); change the schema and re-embed before changing dimensions`
  )
}

// The one resolved configuration boundary for every Lor model role and
// transport concern. Keep it private so credentials cannot be imported or
// accidentally logged by consumers.
const modelConfig = {
  gateway: {
    baseURL: env.AI_GATEWAY_BASE_URL,
    apiKey: env.AI_GATEWAY_API_KEY,
  },
  main: {
    id: env.LOR_MODEL,
    fallbacks: parseFallbacks(env.LOR_MODEL_FALLBACKS),
  },
  small: {
    id: env.LOR_SMALL_MODEL,
    fallbacks: parseFallbacks(env.LOR_SMALL_MODEL_FALLBACKS),
  },
  embedding: {
    id: env.LOR_EMBED_MODEL,
    dimensions: LOR_EMBED_DIMENSIONS,
  },
} as const

const gatewayTransport = createTransport(modelConfig.gateway)

// Backwards-compatible ids for logging and consumers that display the
// requested model. Calls use the resolved model objects below.
export const LOR_MODEL = modelConfig.main.id
export const LOR_FALLBACK_MODELS = modelConfig.main.fallbacks
export const LOR_SMALL_MODEL = modelConfig.small.id
export const LOR_SMALL_FALLBACK_MODELS = modelConfig.small.fallbacks
export const LOR_EMBED_MODEL = modelConfig.embedding.id
export const LOR_EMBED_DIM = modelConfig.embedding.dimensions

export const lorModel = gatewayTransport.languageModel(LOR_MODEL)
export const lorSmallModel = gatewayTransport.languageModel(LOR_SMALL_MODEL)
export const lorEmbeddingModel =
  gatewayTransport.textEmbeddingModel(LOR_EMBED_MODEL)

export const mainGatewayOptions = {
  caching: "auto" as const,
  models: LOR_FALLBACK_MODELS,
}

export const smallGatewayOptions = {
  models: LOR_SMALL_FALLBACK_MODELS,
}
