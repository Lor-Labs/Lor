import type { AgentRunContext } from "@repo/db/schema"
import { env } from "@repo/env/server"
import type { ModelMessage } from "ai"

// Re-exported so the worker can type transcript rows without its own ai dep.
export type { ModelMessage } from "ai"

// Contract between respond() and the durable-run executor (the worker). The
// worker owns Postgres and billing; respond() owns the model loop and calls
// back at step boundaries. See reference/agent-harness.md (execution engine).

export type BudgetStopReason =
  | "budget_steps"
  | "budget_input_tokens"
  | "budget_output_tokens"
  | "budget_tool_calls"
  | "budget_tool_output"
  | "budget_wall_clock"
  | "budget_spend"

// Why the answer loop ended early: a budget ceiling or an explicit user stop.
export type RunStopCause = BudgetStopReason | "stopped_by_user"

// A mid-run message a user aimed at the run (steer row) — injected at the
// next step boundary with attribution.
export type SteeredMessage = {
  messageId: string
  authorName: string
  content: string
}

// What arrived in the conversation since the last step boundary. Steered
// messages carry the delivery guarantee; ambient ones are context only (the
// model is told to act on them only if they're addressed to it).
export type ConversationUpdate = {
  steered: SteeredMessage[]
  ambient: { authorName: string; content: string }[]
}

export type RunBudgets = {
  steps: number
  inputTokens: number
  // Total output tokens (the SDK's outputTokens includes reasoning).
  outputTokens: number
  toolCalls: number
  toolOutputBytes: number
  credits: number
  deadlineAt: Date
}

export type RunCounters = {
  steps: number
  inputTokens: number
  // Cache-read portion of inputTokens (subset, not additional).
  cachedInputTokens: number
  outputTokens: number
  toolCalls: number
  toolOutputBytes: number
  creditsSpent: number
}

// One completed model/tool step, ready to persist.
export type RunStepRecord = {
  step: number
  messages: ModelMessage[]
  model?: string
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  toolCalls: number
  toolOutputBytes: number
}

export type RunToolResultStore = {
  get: (toolKey: string) => Promise<unknown | undefined>
  put: (toolKey: string, toolName: string, output: unknown) => Promise<void>
}

export type RunResume = {
  // Full transcript: rebuilt initial user message + every checkpointed step.
  messages: ModelMessage[]
  instructions: string
  counters: RunCounters
  answerTextSoFar: string
  // Input size of the last checkpointed step, so the resumed loop's first
  // request can trigger compaction before any local step exists.
  lastInputTokens: number
}

export type RunHandle = {
  budgets: RunBudgets
  resume: RunResume | null
  // Persist the step-0 context; called once on a fresh run, before streaming.
  saveContext: (args: {
    context: AgentRunContext
    instructions: string
  }) => Promise<void>
  // Atomically fold a completed step into the run (transcript row + counters,
  // including nested usage like investigate_code). Returns the authoritative
  // cumulative counters; throws if the lease was lost.
  checkpoint: (record: RunStepRecord) => Promise<RunCounters>
  toolResults: RunToolResultStore | null
  abortSignal?: AbortSignal
  // Steering: drain messages that landed mid-run (marks steered rows
  // consumed, emits their events). Called at step boundaries; absent for
  // legacy/eval invocations.
  drainConversation?: () => Promise<ConversationUpdate>
  // Explicit user stop, observed at step boundaries — the loop ends
  // gracefully and the worker settles the run as stopped_by_user.
  stopRequested?: () => boolean
}

export const ZERO_RUN_COUNTERS: RunCounters = {
  steps: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
  toolOutputBytes: 0,
  creditsSpent: 0,
}

// Budgets for a respond() call with no durable run behind it (legacy jobs,
// evals): same env ceilings, wall clock anchored at call time. Credits never
// accumulate without the worker's rate math, so that ceiling is inert here.
export function defaultRunBudgets(): RunBudgets {
  return {
    steps: env.AGENT_RUN_MAX_STEPS,
    inputTokens: env.AGENT_RUN_MAX_INPUT_TOKENS,
    outputTokens: env.AGENT_RUN_MAX_OUTPUT_TOKENS,
    toolCalls: env.AGENT_RUN_MAX_TOOL_CALLS,
    toolOutputBytes: env.AGENT_RUN_MAX_TOOL_OUTPUT_BYTES,
    credits: env.AGENT_RUN_MAX_CREDITS,
    deadlineAt: new Date(Date.now() + env.AGENT_RUN_MAX_WALL_MS),
  }
}

// First ceiling the counters have hit, if any.
export function budgetViolation(
  counters: RunCounters,
  budgets: RunBudgets
): BudgetStopReason | null {
  if (counters.steps >= budgets.steps) return "budget_steps"
  // Cache reads bill at a fraction of fresh input and re-send the same bytes
  // every step, so they count at 1/10 — otherwise long tool loops exhaust the
  // rail on cheap cached re-sends while credits sit far below their ceiling.
  const weightedInputTokens =
    counters.inputTokens - Math.floor(counters.cachedInputTokens * 0.9)
  if (weightedInputTokens >= budgets.inputTokens) return "budget_input_tokens"
  if (counters.outputTokens >= budgets.outputTokens) {
    return "budget_output_tokens"
  }
  if (counters.toolCalls >= budgets.toolCalls) return "budget_tool_calls"
  if (counters.toolOutputBytes >= budgets.toolOutputBytes) {
    return "budget_tool_output"
  }
  if (counters.creditsSpent >= budgets.credits) return "budget_spend"
  if (
    Date.now() >=
    budgets.deadlineAt.getTime() - WALL_CLOCK_ANSWER_MARGIN_MS
  ) {
    return "budget_wall_clock"
  }
  return null
}

// Reserved tail of the wall budget: once inside it, tools are disabled so the
// loop ends with a text answer instead of a hard timeout.
export const WALL_CLOCK_ANSWER_MARGIN_MS = 3 * 60_000

export function addStepToCounters(
  counters: RunCounters,
  record: RunStepRecord
): RunCounters {
  return {
    steps: counters.steps + 1,
    inputTokens: counters.inputTokens + (record.inputTokens ?? 0),
    cachedInputTokens:
      counters.cachedInputTokens + (record.cachedInputTokens ?? 0),
    outputTokens: counters.outputTokens + (record.outputTokens ?? 0),
    toolCalls: counters.toolCalls + record.toolCalls,
    toolOutputBytes: counters.toolOutputBytes + record.toolOutputBytes,
    creditsSpent: counters.creditsSpent,
  }
}
