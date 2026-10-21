import type { AgentRunContext } from "@repo/db/schema"
import { env } from "@repo/env/server"
import type { HarnessOwner, SavedHarnessState } from "./session-core"
import type { PiTurnSave } from "./session-core/pi-runtime"

// Re-exported so the worker can type transcript rows without its own ai dep.
export type { ModelMessage } from "ai"

// Contract between respond() and the durable-run executor (the worker). The
// worker owns Postgres and billing; respond() runs one Pi turn and saves it
// through the harness binding (reference/planned/pi-harness-runbook.md).

export type BudgetStopReason =
  | "budget_steps"
  | "budget_input_tokens"
  | "budget_output_tokens"
  | "budget_tool_calls"
  | "budget_tool_output"
  | "budget_wall_clock"
  | "budget_spend"

// Why the answer loop ended early: a budget ceiling, an explicit user stop, or
// a tool call parked on an approval policy (LOR-81) — the resolved approval
// starts the continuation run.
export type RunStopCause =
  | BudgetStopReason
  | "stopped_by_user"
  | "awaiting_approval"

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
  ambient: { messageId: string; authorName: string; content: string }[]
}

export function conversationUpdateMessageIds(
  update: ConversationUpdate
): string[] {
  return [
    ...new Set(
      [...update.steered, ...update.ambient].map((message) => message.messageId)
    ),
  ]
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

// One finished Pi turn, ready to save: the new Pi log (null when the turn
// wrote nothing) and the turn's totals for the run counters.
export type RunTurnRecord = {
  save: PiTurnSave | null
  steps: number
  model: string | null
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  toolCalls: number
  toolOutputBytes: number
}

// The conversation's saved Pi state and its save. The worker binds it, since
// it owns Postgres and the lease (reference/planned/pi-harness-runbook.md §4.3).
export type RunHarness = {
  owner: HarnessOwner
  saved: SavedHarnessState | null
  // Set when a retried attempt finds this run's turn already saved: respond()
  // delivers it instead of running the turn twice.
  savedAnswer: string | null
  // One transaction under the run's lease: the Pi log, the new head and the
  // counters. Throws when the lease or the saved head moved.
  saveTurn: (turn: RunTurnRecord) => Promise<RunCounters>
}

export type RunToolResultStore = {
  get: (toolKey: string) => Promise<unknown | undefined>
  put: (toolKey: string, toolName: string, output: unknown) => Promise<void>
}

// A retried attempt of an interrupted turn: it sends the saved request again
// from the last saved Pi head. Nothing of the lost attempt's turn survives
// except sandbox files and tool receipts.
export type RunResume = {
  context: AgentRunContext
  counters: RunCounters
}

export type RunHandle = {
  // The agent_run row this handle owns — approval rows and other run-scoped
  // writes reference it.
  runId: string
  budgets: RunBudgets
  resume: RunResume | null
  // Persist the turn's request; called once on a fresh run, before streaming.
  saveContext: (args: {
    context: AgentRunContext
    instructions: string
  }) => Promise<void>
  harness?: RunHarness
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

export function mergeRunContextCoverage(
  context: AgentRunContext,
  messageIds: string[]
): AgentRunContext {
  if (messageIds.length === 0) return context
  const coveredMessageIds = [
    ...new Set([...(context.coveredMessageIds ?? []), ...messageIds]),
  ]
  if (coveredMessageIds.length === context.coveredMessageIds?.length) {
    return context
  }
  return { ...context, coveredMessageIds }
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
