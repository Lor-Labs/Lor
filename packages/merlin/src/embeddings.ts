import { embed } from "ai"
import {
  MERLIN_EMBED_DIM,
  MERLIN_EMBED_MODEL,
  merlinEmbeddingModel,
} from "./models"

export type EmbedResult = {
  embedding: number[]
  tokens: number
  model: string
}

const BRAIN_QUERY_INSTRUCTION =
  "Given a question from a team workspace, retrieve the institutional-memory pages that answer or contextualize it."
const SOURCE_QUERY_INSTRUCTION =
  "Given a question from a team workspace, retrieve external work-event summaries that answer or contextualize it."

function instructedQuery(instruction: string, text: string): string {
  return `Instruct: ${instruction}\nQuery: ${text}`
}

async function embedValue(value: string): Promise<EmbedResult> {
  const { embedding, usage } = await embed({
    model: merlinEmbeddingModel,
    value,
  })
  if (embedding.length !== MERLIN_EMBED_DIM) {
    throw new Error(
      `embedding model "${MERLIN_EMBED_MODEL}" returned ${embedding.length} dims; expected ${MERLIN_EMBED_DIM}`
    )
  }
  return { embedding, tokens: usage.tokens, model: MERLIN_EMBED_MODEL }
}

export function embedDocumentWithUsage(text: string): Promise<EmbedResult> {
  return embedValue(text)
}

export function embedBrainQueryWithUsage(text: string): Promise<EmbedResult> {
  return embedValue(instructedQuery(BRAIN_QUERY_INSTRUCTION, text))
}

export function embedSourceQueryWithUsage(text: string): Promise<EmbedResult> {
  return embedValue(instructedQuery(SOURCE_QUERY_INSTRUCTION, text))
}

export async function embedDocument(text: string): Promise<number[]> {
  const { embedding } = await embedDocumentWithUsage(text)
  return embedding
}

export async function embedBrainQuery(text: string): Promise<number[]> {
  const { embedding } = await embedBrainQueryWithUsage(text)
  return embedding
}

export async function embedSourceQuery(text: string): Promise<number[]> {
  const { embedding } = await embedSourceQueryWithUsage(text)
  return embedding
}
