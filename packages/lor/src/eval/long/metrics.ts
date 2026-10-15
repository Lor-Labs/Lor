import type { ModelMessage, UsageEvent } from "../../index"

export type TranscriptStats = {
  steps: number
  toolCalls: number
  // Calls repeating an earlier call's exact name + input.
  duplicateCalls: number
  maxRepeat: number
}

export function transcriptStats(messages: ModelMessage[]): TranscriptStats {
  let steps = 0
  const counts = new Map<string, number>()
  let toolCalls = 0
  for (const m of messages) {
    if (m.role !== "assistant") continue
    steps++
    if (typeof m.content === "string") continue
    for (const part of m.content) {
      if (part.type !== "tool-call") continue
      toolCalls++
      const key = `${part.toolName}:${JSON.stringify(part.input)}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return {
    steps,
    toolCalls,
    duplicateCalls: toolCalls - counts.size,
    maxRepeat: Math.max(0, ...counts.values()),
  }
}

// Character floods ("!!!!…") and one sentence on repeat: the degeneration
// GLM 5.3 Flash shows under long multi-tool prompts.
export function isDegenerate(text: string): boolean {
  if (/([^\s\-=_*#.|])\1{40,}/.test(text)) return true
  const counts = new Map<string, number>()
  for (const raw of text.split(/(?<=[.!?\n])/)) {
    const sentence = raw.trim()
    if (sentence.length < 12) continue
    const n = (counts.get(sentence) ?? 0) + 1
    if (n >= 6) return true
    counts.set(sentence, n)
  }
  return false
}

export type TokenTotals = { input: number; cached: number; output: number }

export function tokenTotals(events: UsageEvent[]): TokenTotals {
  const totals = { input: 0, cached: 0, output: 0 }
  for (const e of events) {
    if (/embedding|rerank/i.test(e.model ?? "")) continue
    totals.input += e.inputTokens ?? 0
    totals.cached += e.cachedInputTokens ?? 0
    totals.output += e.outputTokens ?? 0
  }
  return totals
}

// Gateway list $/Mtok (input, cached input, output); MiMo at DeepInfra.
const PRICES: Record<string, [number, number, number]> = {
  "zai/glm-5.3-flash": [0.15, 0.03, 0.5],
  "deepseek/deepseek-v4.1-flash": [0.3, 0.007, 1.2],
  "moonshotai/kimi-k3": [3, 0.3, 15],
  "xiaomi/mimo-v2.6-pro": [0.43, 0.0036, 0.87],
}

// Prices every language-model token at the main model's rate; the few
// small-model calls make this a slight overestimate.
export function estimateCostUsd(model: string, t: TokenTotals): number | null {
  const price = PRICES[model]
  if (!price) return null
  const [input, cached, output] = price
  const uncached = Math.max(0, t.input - t.cached)
  return (uncached * input + t.cached * cached + t.output * output) / 1_000_000
}
