import { describe, expect, it } from "vitest"
import { type CreditRate, computeCostUsd, computeCredits } from "./credits"

const rate: CreditRate = {
  inputUsdPerMtok: 3,
  cachedInputUsdPerMtok: 0.3,
  outputUsdPerMtok: 15,
  conversionRate: 2.5,
}

describe("computeCostUsd", () => {
  it("prices input, cached input and output at their own rates", () => {
    const cost = computeCostUsd(
      { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 },
      rate
    )
    expect(cost).toBeCloseTo(18)
  })

  it("subtracts cached tokens from input so they are never double-billed", () => {
    const cost = computeCostUsd(
      {
        inputTokens: 1_000_000,
        cachedInputTokens: 400_000,
        outputTokens: 0,
      },
      rate
    )
    expect(cost).toBeCloseTo(600_000 * 3e-6 + 400_000 * 0.3e-6)
  })

  it("clamps input to zero when the provider reports cached separately", () => {
    const cost = computeCostUsd(
      { inputTokens: 100, cachedInputTokens: 500, outputTokens: 0 },
      rate
    )
    expect(cost).toBeCloseTo(500 * 0.3e-6)
  })

  it("treats missing counts as zero", () => {
    expect(computeCostUsd({}, rate)).toBe(0)
  })
})

describe("computeCredits", () => {
  it("applies the conversion rate and converts to 1-cent credits, rounding up", () => {
    // $0.018 cost × 2.5 = $0.045 retail → 4.5 credits → 5
    const credits = computeCredits(
      { inputTokens: 1_000, outputTokens: 1_000 },
      rate
    )
    expect(credits).toBe(5)
  })

  it("floors at 1 credit", () => {
    expect(computeCredits({ inputTokens: 1 }, rate)).toBe(1)
    expect(computeCredits({}, rate)).toBe(1)
  })

  it("matches the spec example: a standard query", () => {
    // ~10k in / ~1k out on Sonnet-ish rates
    const credits = computeCredits(
      { inputTokens: 10_000, outputTokens: 1_000 },
      rate
    )
    // (10k×$3 + 1k×$15)/M = $0.045 × 2.5 = $0.1125 → 12 credits
    expect(credits).toBe(12)
  })
})
