import { relations, sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { approval } from "./approvals"
import { channel } from "./channels"
import { connectorTrigger } from "./connector-triggers"
import { loop } from "./loops"
import type { LorToolCall } from "./messages"
import { message } from "./messages"
import type { PlanStatus, PlanStep } from "./plans"
import { triggerDelivery } from "./trigger-deliveries"
import type { SandboxMode } from "./user-sandbox-settings"
import { user } from "./users"
import { workspace } from "./workspaces"

// Durable agent run. BullMQ schedules the work; this row is the source of
// truth for state, ordering, budgets, and checkpoints.
// See reference/agent-harness.md.
export const agentRunStateEnum = pgEnum("agent_run_state", [
  "queued",
  "working",
  "finalizing",
  "complete",
  "failed",
  "stopped",
])

export const agentRunPhaseEnum = pgEnum("agent_run_phase", [
  "answer",
  "writeback",
])

export const agentRunStopReasonEnum = pgEnum("agent_run_stop_reason", [
  "completed",
  "budget_steps",
  "budget_input_tokens",
  "budget_output_tokens",
  "budget_tool_calls",
  "budget_tool_output",
  "budget_wall_clock",
  "budget_spend",
  "out_of_credits",
  "error",
  "stopped_by_user",
  "awaiting_approval",
])

export const agentRun = pgTable(
  "agent_run",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    // The placeholder message the run streams into — also the client's handle
    // for replay (clients know the message id, not the run id, on load). Null
    // on an Act run until its session exists, and on old headless Act runs.
    messageId: uuid("message_id").references(() => message.id, {
      onDelete: "cascade",
    }),
    threadRootId: uuid("thread_root_id").references(() => message.id, {
      onDelete: "cascade",
    }),
    triggerMessageId: uuid("trigger_message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    // Conversation scope = threadRootId ?? channelId (an Act run holds its
    // triggerId until its session exists). The partial unique index below
    // enforces one active run per scope — a mention during an active run
    // steers or queues instead of creating a sibling.
    scopeKey: uuid("scope_key").notNull(),

    // Trigger provenance (Act effect): which trigger + delivery started this
    // run. Null on conversational runs; nulled (not cascaded) on trigger
    // deletion so the run keeps its audit value.
    triggerId: uuid("trigger_id").references(() => connectorTrigger.id, {
      onDelete: "set null",
    }),
    deliveryId: uuid("delivery_id").references(() => triggerDelivery.id, {
      onDelete: "set null",
    }),

    // Loop provenance: which loop's schedule fired this run. Null on every
    // other run kind; nulled (not cascaded) on loop deletion so the run
    // keeps its audit value. Loop runs use scopeKey = loop.id.
    loopId: uuid("loop_id").references(() => loop.id, {
      onDelete: "set null",
    }),
    // Loop runs: when the schedule meant this run to fire — createdAt is
    // when the sweep claimed it (late when the worker was down; catch-up
    // fires once). Loop history sorts by this.
    scheduledFor: timestamp("scheduled_for"),

    state: agentRunStateEnum("state").notNull().default("queued"),
    phase: agentRunPhaseEnum("phase").notNull().default("answer"),
    stopReason: agentRunStopReasonEnum("stop_reason"),

    // Explicit user stop: the API sets this; the lease holder honors it at
    // the next step boundary (state flips to stopped there, not here).
    stopRequestedAt: timestamp("stop_requested_at"),
    stopRequestedBy: uuid("stop_requested_by").references(() => user.id, {
      onDelete: "set null",
    }),

    // Event-log sequence allocator. The lease-holding worker is the sole
    // writer: it numbers events in memory from this value and persists the
    // high-water mark with each batched event flush.
    nextSeq: integer("next_seq").notNull().default(0),

    // Execution ownership. Every counter/state write is guarded on the lease
    // so a retry or concurrent worker can never double-own or double-spend.
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(2),

    // Hard ceilings, snapshotted at creation from env defaults — an in-flight
    // run keeps its budgets across retries and config changes. Emergency
    // rails, not normal stopping targets.
    budgetSteps: integer("budget_steps").notNull().default(100),
    budgetInputTokens: integer("budget_input_tokens")
      .notNull()
      .default(1_000_000),
    budgetOutputTokens: integer("budget_output_tokens")
      .notNull()
      .default(150_000),
    budgetToolCalls: integer("budget_tool_calls").notNull().default(200),
    budgetToolOutputBytes: integer("budget_tool_output_bytes")
      .notNull()
      .default(2_097_152),
    budgetWallMs: integer("budget_wall_ms").notNull().default(1_800_000),
    budgetCredits: integer("budget_credits").notNull().default(500),

    // Cumulative counters across the whole run — persisted at each step
    // checkpoint and reused (never reset) by recovery. `steps` doubles as the
    // checkpoint pointer: transcript rows 1..steps are durable.
    steps: integer("steps").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    // Cache-read portion of inputTokens; the input budget weights these at
    // 1/10 so cheap cached re-sends don't exhaust the rail (LOR-66 follow-up).
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    toolOutputBytes: integer("tool_output_bytes").notNull().default(0),
    creditsSpent: integer("credits_spent").notNull().default(0),

    // Wall-clock ceiling as an absolute timestamp (startedAt + budgetWallMs at
    // first claim) so recovery cannot extend it.
    deadlineAt: timestamp("deadline_at"),

    // Step-0 context: everything needed to rebuild the initial model request
    // byte-for-byte on resume (conversation snapshot, brain prefetch, roster)
    // without re-querying — no drift, no double embed billing. Image bytes are
    // re-fetched from their URLs.
    context: jsonb("context").$type<AgentRunContext>(),
    instructions: text("instructions"),

    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),

    // Act runs only: the reply that answered the event, kept for the NEXT run
    // on the same trigger — what it concluded, what it did, what to watch
    // for. Runs on a trigger are serialized (one active per triggerId), so
    // these form a coherent chain rather than interleaved chatter.
    // See reference/automation-primitives.md §5.
    handoffNote: text("handoff_note"),

    // Set when this run continued a predecessor's transcript instead of
    // rebuilding context from the chat snapshot (reference/context-continuation.md).
    // Recovery depends on this pointer plus predecessor-chain replay to rebuild
    // the inherited prefix. Deletion still uses set null rather than cascading
    // into the run that followed it.
    continuedFromRunId: uuid("continued_from_run_id").references(
      (): AnyPgColumn => agentRun.id,
      { onDelete: "set null" }
    ),

    // Durable compaction state, overwritten on each mid-run compaction. The
    // baseline is the post-compaction message array the model was actually
    // sent, so recovery/continuation replays baseline + steps after atStep
    // instead of the raw transcript (which can exceed the model context once
    // a compaction has happened). Best-effort: when null or stale, replay
    // falls back to the raw chain and re-compacts on the first step.
    compaction: jsonb("compaction").$type<AgentRunCompaction>(),
  },
  (table) => [
    uniqueIndex("agent_run_messageId_uidx").on(table.messageId),
    index("agent_run_scopeKey_state_idx").on(table.scopeKey, table.state),
    // One active run per conversation scope, arbitrated by Postgres. The
    // trigger path relies on this failing the insert to route a mid-run
    // mention into steer/queue instead.
    uniqueIndex("agent_run_scopeKey_active_uidx")
      .on(table.scopeKey)
      .where(sql`state in ('queued', 'working', 'finalizing')`),
    // One active Act run per trigger, whichever session it runs in.
    uniqueIndex("agent_run_triggerId_active_uidx")
      .on(table.triggerId)
      .where(
        sql`trigger_id is not null and state in ('queued', 'working', 'finalizing')`
      ),
    index("agent_run_workspaceId_createdAt_idx").on(
      table.workspaceId,
      table.createdAt
    ),
    // Daily run-cap check for Act triggers counts recent runs per trigger.
    index("agent_run_triggerId_createdAt_idx").on(
      table.triggerId,
      table.createdAt
    ),
    // Loop history + daily run-cap queries.
    index("agent_run_loopId_createdAt_idx").on(table.loopId, table.createdAt),
  ]
)

export const agentRunQueueStateEnum = pgEnum("agent_run_queue_state", [
  "queued",
  "steered",
  "consumed",
  "rejected",
  // Sender withdrew the queued message before a drain picked it up.
  "cancelled",
])

// Mid-run messages routed at the active run: `steered` rows are injected at
// the next safe step boundary; `queued` rows start the follow-up run when the
// scope frees up. The message row is the content — this table is ordering +
// lifecycle. Never silently dropped: steered rows an ending run didn't drain
// are swept into the completion drain as queued work.
export const agentRunQueue = pgTable(
  "agent_run_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    scopeKey: uuid("scope_key").notNull(),
    // The run that was active when this arrived (audit + steer drain target).
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    state: agentRunQueueStateEnum("state").notNull().default("queued"),
    // Set when this queued message is a decided approval set riding behind an
    // active run: the drained follow-up finishes the paused turn instead of
    // building a delta, unless another run finished it first. Lazy
    // AnyPgColumn reference because approvals.ts imports this file.
    resumeApprovalId: uuid("resume_approval_id").references(
      (): AnyPgColumn => approval.id,
      { onDelete: "set null" }
    ),
    // Steer promotes the row to the front of the drain order (before
    // unpromoted rows, FIFO among promoted).
    promotedAt: timestamp("promoted_at"),
    // The step whose checkpoint carries the injected copy (0 = covered by the
    // step-0 snapshot). A takeover requeues consumed rows whose step never
    // checkpointed, so a crash can't drop a steered message.
    consumedAtStep: integer("consumed_at_step"),
  },
  (table) => [
    index("agent_run_queue_scopeKey_state_idx").on(table.scopeKey, table.state),
    index("agent_run_queue_runId_state_idx").on(table.runId, table.state),
    // A message routes at a run exactly once.
    uniqueIndex("agent_run_queue_messageId_uidx").on(table.messageId),
  ]
)

// Append-only transcript: one row per completed model/tool step, holding the
// ModelMessages that step added. Recovery rebuilds the request as step-0
// context + rows 1..agent_run.steps. Typed as unknown[] because @repo/db
// cannot depend on the ai package; @repo/lor owns the real ModelMessage
// shape on both write and read.
export const agentRunStep = pgTable(
  "agent_run_step",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    step: integer("step").notNull(),
    messages: jsonb("messages").$type<unknown[]>().notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    toolCalls: integer("tool_calls").notNull().default(0),
    toolOutputBytes: integer("tool_output_bytes").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.step] })]
)

// Side-effecting tool executions, keyed by a hash of tool name + canonical
// input (toolCallIds regenerate when a step retries; input identity doesn't).
// A retried step returns the stored output instead of executing again, so
// completed actions never run twice. Output shape is per-tool, hence unknown.
export const agentRunToolResult = pgTable(
  "agent_run_tool_result",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    toolKey: text("tool_key").notNull(),
    toolName: text("tool_name").notNull(),
    output: jsonb("output").$type<unknown>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.toolKey] })]
)

export const agentRunEventKindEnum = pgEnum("agent_run_event_kind", [
  "text",
  "reasoning",
  "tool",
  "memory",
  "state",
  "steer",
  "queued",
  "truncate",
])

// Ordered run-event log: what the worker streamed, batched for replay. Live
// socket frames carry the same seq, so a late joiner replays persisted events
// then drains buffered frames without gaps or reordering. Redundant once the
// run is terminal (the message row holds the final content/trail); pruned by
// a retention job.
export const agentRunEvent = pgTable(
  "agent_run_event",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: agentRunEventKindEnum("kind").notNull(),
    payload: jsonb("payload").$type<AgentRunEventPayload>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.seq] })]
)

export const agentRunRelations = relations(agentRun, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [agentRun.workspaceId],
    references: [workspace.id],
  }),
  channel: one(channel, {
    fields: [agentRun.channelId],
    references: [channel.id],
  }),
  message: one(message, {
    fields: [agentRun.messageId],
    references: [message.id],
  }),
  events: many(agentRunEvent),
}))

export const agentRunEventRelations = relations(agentRunEvent, ({ one }) => ({
  run: one(agentRun, {
    fields: [agentRunEvent.runId],
    references: [agentRun.id],
  }),
}))

// Snapshot of the inputs to the initial model request. Mirrors @repo/lor's
// ConversationTurn structurally; kept here because the column type lives with
// the table.
export type AgentRunContextImage = {
  url: string
  filename: string
  mediaType: string
  size: number
}
// Non-image attachments (CSVs, documents) — surfaced to the model as text
// lines with their URLs so file tools can pull them as inputs.
export type AgentRunContextFile = AgentRunContextImage
export type AgentRunContextTurn = {
  messageId?: string
  authorName: string
  content: string
  images?: AgentRunContextImage[]
  files?: AgentRunContextFile[]
}
// Plan state as of the run's start. Lives in the snapshot (not the system
// prompt) because status/plan/summary change on every set_plan — keeping them
// out of the instructions leaves the cached prompt prefix stable across a
// plan's runs.
export type AgentRunContextPlan = {
  title: string
  goal: string
  status: PlanStatus
  steps: PlanStep[]
  summary: string | null
}
export type AgentRunContextWorkspace = {
  name: string
  website?: string
  description?: string
}
// Approval resume (LOR-81): a continuation started by resolving a policy gate
// carries the tool-approval-response instead of a delta message. Replayed
// verbatim so the parked tool call stays paired on every later replay —
// without it the provider rejects the transcript (unpaired tool call).
export type AgentRunApprovalResume = {
  approvalId: string
  approved: boolean
  toolName: string
  target: string
  reason?: string
}
export type AgentRunContext = {
  conversation: AgentRunContextTurn[]
  // Nearby channel messages are reference material, outside the active thread.
  backgroundConversation?: AgentRunContextTurn[]
  threadRootId?: string
  triggerMessageId?: string
  // Injected brain pages; only snapshots from before memory moved into
  // `search` carry it, and their replays must keep it.
  brainContext?: string
  rosterText: string
  // Optional so pre-existing snapshots (and DM channels, which have no name)
  // keep parsing.
  channelName?: string
  channelTopic?: string
  // Cold-start context from onboarding; absent on older snapshots.
  workspace?: AgentRunContextWorkspace
  plan?: AgentRunContextPlan
  // Continued runs only (agentRun.continuedFromRunId set): the exact rendered
  // delta message appended after the inherited transcript. Stored rather than
  // re-rendered because it embeds elapsed time ("about 3 hours since then"),
  // which would drift on recovery and break the byte-stable replay.
  continuationDelta?: string
  // Set instead of continuationDelta when this run resumed a parked approval.
  approvalResume?: AgentRunApprovalResume
  // Serialized size of the tool schemas bound to this run. Tool definitions are
  // re-sent on every request but live nowhere else on the row, so the context
  // meter would otherwise fold them into the other segments invisibly. Which
  // tools are bound depends on the channel's connectors, hence per-run.
  toolSchemaBytes?: number
  // Includes the inherited transcript on continuations, before the first checkpoint.
  initialMessagesTokens?: number
  // Message IDs injected at step boundaries and committed with the checkpoint
  // that first exposed them to the model. Optional for pre-existing snapshots.
  coveredMessageIds?: string[]
  // The sandbox mode the turn runs under, frozen at its start so a retry or a
  // changed setting never runs a call under a looser mode.
  sandboxMode?: TurnSandboxMode
}

// A person's sandbox mode, or autonomous for Loop and Act runs (no one to ask).
export type TurnSandboxMode = SandboxMode | "autonomous"

// Written by @repo/lor at compaction time (see compaction.ts). summary is
// the rolling working notes — the next run in this scope seeds its compactor
// with it so facts merge forward instead of being rebuilt from a clipped
// digest. baselineMessages are ModelMessages, typed unknown[] for the same
// reason as agentRunStep.messages.
export type AgentRunCompaction = {
  summary: string | null
  summaryFailures: number
  baselineMessages: unknown[]
  messageTokens?: number
  atStep: number
}

export type AgentRun = typeof agentRun.$inferSelect
export type AgentRunStep = typeof agentRunStep.$inferSelect
export type AgentRunToolResult = typeof agentRunToolResult.$inferSelect
export type AgentRunState = (typeof agentRunStateEnum.enumValues)[number]
export type AgentRunPhase = (typeof agentRunPhaseEnum.enumValues)[number]
export type AgentRunStopReason =
  (typeof agentRunStopReasonEnum.enumValues)[number]
export type AgentRunEventKind =
  (typeof agentRunEventKindEnum.enumValues)[number]

export type AgentRunEventPayload =
  | { kind: "text"; delta: string; replace?: boolean }
  | { kind: "reasoning"; delta: string; at: number; order: number }
  | { kind: "tool"; toolCall: LorToolCall }
  | {
      kind: "memory"
      path: string
      action: "created" | "updated"
      nodeId?: string
    }
  | {
      kind: "state"
      state: AgentRunState
      phase?: AgentRunPhase
      stopReason?: AgentRunStopReason
    }
  // A steered message was injected at a step boundary.
  | { kind: "steer"; messageId: string; authorName: string }
  // A mid-run message was deferred to the follow-up run.
  | { kind: "queued"; messageId: string }
  | { kind: "truncate"; contentLength: number }

export type AgentRunEvent = typeof agentRunEvent.$inferSelect
export type AgentRunQueueRow = typeof agentRunQueue.$inferSelect
export type AgentRunQueueState =
  (typeof agentRunQueueStateEnum.enumValues)[number]
