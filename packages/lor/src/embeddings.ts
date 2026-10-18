import { embed, embedMany } from "ai"
import { LOR_EMBED_DIM, LOR_EMBED_MODEL, lorEmbeddingModel } from "./models"

export type EmbedResult = {
  embedding: number[]
  tokens: number
  model: string
}

const BRAIN_QUERY_INSTRUCTION =
  "Given a question from a team workspace, retrieve the institutional-memory pages that answer or contextualize it."
const SOURCE_QUERY_INSTRUCTION =
  "Given a question from a team workspace, retrieve passages from its pull requests, issues, notes, and call transcripts in connected tools that answer or contextualize it."
const ATTACHMENT_QUERY_INSTRUCTION =
  "Given a question from a team workspace, retrieve screenshots, images, and files shared in chat whose contents answer or contextualize it."
const CALL_QUERY_INSTRUCTION =
  "Given a question from a team workspace, retrieve passages from the team's voice call transcripts and call summaries that answer or contextualize it."

function instructedQuery(instruction: string, text: string): string {
  return `Instruct: ${instruction}\nQuery: ${text}`
}

async function embedValue(value: string): Promise<EmbedResult> {
  const { embedding, usage } = await embed({
    model: lorEmbeddingModel,
    value,
  })
  if (embedding.length !== LOR_EMBED_DIM) {
    throw new Error(
      `embedding model "${LOR_EMBED_MODEL}" returned ${embedding.length} dims; expected ${LOR_EMBED_DIM}`
    )
  }
  return { embedding, tokens: usage.tokens, model: LOR_EMBED_MODEL }
}

export function embedDocumentWithUsage(text: string): Promise<EmbedResult> {
  return embedValue(text)
}

export async function embedDocumentsWithUsage(
  texts: string[]
): Promise<{ embeddings: number[][]; tokens: number; model: string }> {
  const { embeddings, usage } = await embedMany({
    model: lorEmbeddingModel,
    values: texts,
  })
  if (embeddings.some((e) => e.length !== LOR_EMBED_DIM)) {
    throw new Error(
      `embedding model "${LOR_EMBED_MODEL}" returned the wrong dims; expected ${LOR_EMBED_DIM}`
    )
  }
  return { embeddings, tokens: usage.tokens, model: LOR_EMBED_MODEL }
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

export async function embedAttachmentQuery(text: string): Promise<number[]> {
  const { embedding } = await embedValue(
    instructedQuery(ATTACHMENT_QUERY_INSTRUCTION, text)
  )
  return embedding
}

export async function embedCallQuery(text: string): Promise<number[]> {
  const { embedding } = await embedValue(
    instructedQuery(CALL_QUERY_INSTRUCTION, text)
  )
  return embedding
}
