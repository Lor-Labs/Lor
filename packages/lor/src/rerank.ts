import { rerank } from "ai"
import { logger } from "./logger"
import {
  LOR_RERANK_ENABLED,
  LOR_RERANK_MIN_SCORE,
  LOR_RERANK_MODEL,
  lorRerankModel,
} from "./models"
import { emitUsage, type OnUsage } from "./usage"

const DOCUMENT_MAX_CHARS = 2000
const TIMEOUT_MS = 2000

export const RERANK_MIN_SCORE = LOR_RERANK_MIN_SCORE

// Relevance-scores retrieval candidates against the query, best first. Null
// means the rerank was off, skipped, or failed: callers keep their own order
// and apply no cutoff (fail open). The gateway reports cost, not tokens.
export async function rerankTexts({
  workspaceId,
  query,
  documents,
  onUsage,
}: {
  workspaceId: string
  query: string
  documents: string[]
  onUsage?: OnUsage
}): Promise<{ index: number; score: number }[] | null> {
  if (!LOR_RERANK_ENABLED || documents.length === 0 || !query.trim()) {
    return null
  }
  try {
    const result = await rerank({
      model: lorRerankModel,
      query,
      documents: documents.map((d) => d.slice(0, DOCUMENT_MAX_CHARS)),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const cost = Number(result.providerMetadata?.gateway?.cost)
    emitUsage(onUsage, {
      workspaceId,
      tool: "lor.rerank",
      model: LOR_RERANK_MODEL,
      ...(Number.isFinite(cost) ? { costUsd: cost } : {}),
      metadata: { documents: documents.length },
    })
    return result.ranking.map((r) => ({
      index: r.originalIndex,
      score: r.score,
    }))
  } catch (err) {
    logger.warn({ err }, "Rerank failed; keeping retrieval order")
    return null
  }
}

// The best `limit` items, reordered by relevance with no cutoff: connector
// searches the model asked for, where titles can be too thin to score well.
// With no workspace to meter against, or on fail-open, the first `limit`
// items in their original order.
export async function rerankItems<T>({
  workspaceId,
  query,
  items,
  toText,
  limit,
  onUsage,
}: {
  workspaceId: string | undefined
  query: string
  items: T[]
  toText: (item: T) => string
  limit: number
  onUsage?: OnUsage
}): Promise<T[]> {
  if (!workspaceId) return items.slice(0, limit)
  const ranking = await rerankTexts({
    workspaceId,
    query,
    documents: items.map(toText),
    onUsage,
  })
  if (!ranking) return items.slice(0, limit)
  return ranking.slice(0, limit).flatMap((r) => {
    const item = items[r.index]
    return item === undefined ? [] : [item]
  })
}
