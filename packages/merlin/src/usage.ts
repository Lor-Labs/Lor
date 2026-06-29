export type UsageEvent = {
  workspaceId: string
  tool: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  metadata?: Record<string, unknown>
}

export type OnUsage = (event: UsageEvent) => void
