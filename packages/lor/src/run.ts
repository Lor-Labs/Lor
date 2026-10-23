import type {
  AgentRunContext,
  ApprovalKind,
  TurnSandboxMode,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import type { HarnessOwner, SavedHarnessState } from "./session-core"
import type { PiTurnSave } from "./session-core/pi-runtime"

// Re-exported so the worker can type transcript rows without its own ai dep.
export type { ModelMessage } from "ai"

// Contract between respond() and the durable-run executor (the worker). The
// worker owns Postgres and billing; respond() runs one Pi turn and saves it
// through the harness binding (reference/planned/pi-harness-runbook.md).

export type BudgetStopReason = "budget_wall_clock" | "budget_spend"

// Why the answer loop ended early: a budget ceiling, an explicit user stop, or
// a turn paused on approvals — the last decision starts the continuation run.
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

// One call a paused turn waits on. The worker files it as an approval row in
// the same transaction as the save.
export type PendingApproval = {
  harnessApprovalId: string
  toolCallId: string
  toolName: string
  kind: ApprovalKind
  target: string | null
  action: string
  description: string
  payload: unknown
  inputSha256: string
}

// The decision on one pending approval of the paused turn, from its row.
// `reason` is what the model reads when the call is not run.
export type ApprovalDecision = {
  harnessApprovalId: string
  approved: boolean
  // A person pressed reject: not steered past, expired or revoked.
  rejectedByPerson: boolean
  reason: string
  toolName: string
  kind: ApprovalKind
  target: string | null
  inputSha256: string | null
}

export type PausedTurnDrop =
  | { reason: "stopped"; by: string }
  | { reason: "upgraded" }

// One model call of a turn, priced at the model that answered.
export type RunStepRecord = {
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

// One finished or paused Pi turn, ready to save: the new Pi log (null when
// nothing changed), the counters its steps did not already record, and the
// approvals it paused on.
export type RunTurnRecord = {
  save: PiTurnSave | null
  // Usage in Pi's turn total beyond the recorded steps and compactions:
  // cache warming.
  extraUsage: RunStepRecord | null
  toolCalls: number
  toolOutputBytes: number
  approvals: PendingApproval[]
  planId: string | null
  // Set when the turn ended paused; saved with the approvals.
  pausedSandbox: AgentRunContext["pausedSandbox"] | null
  // Ambient messages the turn saved into the Pi log, added to the run's
  // coverage so the next turn's delta skips them.
  coveredMessageIds: string[]
  // Pi's context count after the turn, for the context meter.
  contextUsage: AgentRunContext["contextUsage"] | null
}

// The conversation's saved Pi state and its save. The worker binds it, since
// it owns Postgres and the lease (reference/planned/pi-harness-runbook.md §4.3).
export type RunHarness = {
  owner: HarnessOwner
  saved: SavedHarnessState | null
  // Set when a retried attempt finds this run's turn already saved: respond()
  // delivers it instead of running the turn twice.
  savedAnswer: string | null
  // Set when the saved turn paused on approvals: one decision per row of the
  // set. respond() finishes that turn first, then sends its own prompt.
  pausedDecisions: ApprovalDecision[] | null
  // Set when the saved paused turn is dropped instead of finished: a person
  // pressed Stop, or another adapter version saved it. Its calls read as not
  // run, and respond() tells the model why.
  pausedDropped: PausedTurnDrop | null
  // The run only finishes the paused turn (the last approval was decided):
  // no new prompt.
  continueOnly: boolean
  // How the turn's `bash`, `write` and `edit` calls are approved, frozen at
  // its start (the worker resolves it; respond() saves it with the request).
  sandboxMode: TurnSandboxMode
  pausedSandboxContext?: AgentRunContext["sandboxContext"]
  pausedSandboxMode?: TurnSandboxMode
  // Adds one model call (a step, or a compaction summary that is not a step)
  // to the run counters under the run's lease, so spend is checked inside
  // the turn. Throws when the lease moved.
  recordUsage: (
    usage: RunStepRecord,
    kind: "step" | "compaction"
  ) => Promise<RunCounters>
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

// Budgets for a respond() call with no durable run behind it (evals): the
// env limits, wall clock anchored at call time. Credits never accumulate
// without the worker's rate math, so that limit is inert here.
export function defaultRunBudgets(): RunBudgets {
  return {
    credits: env.AGENT_RUN_MAX_CREDITS,
    deadlineAt: new Date(Date.now() + env.AGENT_RUN_MAX_WALL_MS),
  }
}

// Reserved tail of the wall budget: once inside it, tools are disabled so the
// loop ends with a text answer instead of a hard timeout.
export const WALL_CLOCK_ANSWER_MARGIN_MS = 3 * 60_000
