import { env } from "@repo/env/server"
import { embed } from "ai"

const EMBED_DIM = 1536

export type EmbedResult = {
  embedding: number[]
  tokens: number
  model: string
}

export async function embedTextWithUsage(text: string): Promise<EmbedResult> {
  const { embedding, usage } = await embed({
    model: env.MERLIN_EMBED_MODEL,
    value: text,
  })
  if (embedding.length !== EMBED_DIM) {
    throw new Error(
      `embedding model "${env.MERLIN_EMBED_MODEL}" returned ${embedding.length} dims; expected ${EMBED_DIM}`
    )
  }
  return { embedding, tokens: usage.tokens, model: env.MERLIN_EMBED_MODEL }
}

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embedTextWithUsage(text)
  return embedding
}
