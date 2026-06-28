// Per-tool-invocation usage — the seam for future metering/billing. We don't
// have Stripe wired yet, so today the worker just logs these; later, implement
// `OnUsage` to persist a usage row + report to Stripe. Kept general (any tool can
// emit it), though the expensive one to meter first is the code sandbox agent.
export type UsageEvent = {
  workspaceId: string
  // The tool that incurred the cost, e.g. "investigate_code".
  tool: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  // Provider-reported cost when available (e.g. Claude Code's total_cost_usd).
  costUsd?: number
  // Free-form context for attribution/debugging (repo, sha, …).
  metadata?: Record<string, unknown>
}

export type OnUsage = (event: UsageEvent) => void
