export type UsageEvent = {
  workspaceId: string
  tool: string
  // Model actually served — the gateway fallback can differ from the request.
  model?: string
  requestedModel?: string
  inputTokens?: number
  cachedInputTokens?: number
  // Includes reasoning tokens (providers bill thinking as output).
  outputTokens?: number
  reasoningTokens?: number
  wallMs?: number
  toolCalls?: number
  costUsd?: number
  // Stable within the parent response; used for retry-safe tool debits.
  billingKey?: string
  metadata?: Record<string, unknown>
}

export type OnUsage = (event: UsageEvent) => void

// A metering callback failure must never change ingestion outcomes.
export function emitUsage(onUsage: OnUsage | undefined, event: UsageEvent) {
  try {
    onUsage?.(event)
  } catch {
    // metering is best-effort
  }
}
