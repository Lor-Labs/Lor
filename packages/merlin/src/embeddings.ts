import { env } from "@repo/env/server"
import { embed } from "ai"

const EMBED_DIM = 1536

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: env.MERLIN_EMBED_MODEL,
    value: text,
  })
  if (embedding.length !== EMBED_DIM) {
    throw new Error(
      `embedding model "${env.MERLIN_EMBED_MODEL}" returned ${embedding.length} dims; expected ${EMBED_DIM}`
    )
  }
  return embedding
}
