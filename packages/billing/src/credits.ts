import { CREDIT_USD } from "./constants"

export type CreditRate = {
  inputUsdPerMtok: number
  cachedInputUsdPerMtok: number
  outputUsdPerMtok: number
  conversionRate: number
}

export type TokenCounts = {
  inputTokens?: number
  cachedInputTokens?: number
  // Includes reasoning tokens — providers bill thinking as output.
  outputTokens?: number
}

const MTOK = 1_000_000

// Providers disagree on whether inputTokens includes cached tokens (OpenAI:
// yes, Anthropic: no). Subtracting keeps the billed input non-overlapping
// either way — worst case slightly under-bills cached input, never over.
export function computeCostUsd(tokens: TokenCounts, rate: CreditRate): number {
  const cached = tokens.cachedInputTokens ?? 0
  const input = Math.max(0, (tokens.inputTokens ?? 0) - cached)
  const output = tokens.outputTokens ?? 0
  return (
    (input * rate.inputUsdPerMtok +
      cached * rate.cachedInputUsdPerMtok +
      output * rate.outputUsdPerMtok) /
    MTOK
  )
}

export function computeCredits(tokens: TokenCounts, rate: CreditRate): number {
  return creditsForCost(computeCostUsd(tokens, rate), rate.conversionRate)
}

// A request on the workspace's own AI key pays only the conversion rate's
// part above cost, on the provider's list price (1.05 → a 5% platform fee).
export function byokFeeShare(conversionRate: number) {
  return Math.max(0, conversionRate - 1)
}

export function creditsForCost(costUsd: number, conversionRate: number) {
  return Math.max(1, Math.ceil((costUsd * conversionRate) / CREDIT_USD))
}
