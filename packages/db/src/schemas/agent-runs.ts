import { relations } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { channel } from "./channels"
import type { MerlinToolCall } from "./messages"
import { message } from "./messages"
import { workspace } from "./workspaces"

// Durable agent run. BullMQ schedules the work; this row is the source of
// truth for state, ordering, and (from slice 2) budgets and checkpoints.
// See reference/agent-harness-plan.md.
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
    // for replay (clients know the message id, not the run id, on load).
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    threadRootId: uuid("thread_root_id").references(() => message.id, {
      onDelete: "cascade",
    }),
    triggerMessageId: uuid("trigger_message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    // Conversation scope = threadRootId ?? channelId. Indexed non-unique for
    // now; the partial-unique "one active run per scope" constraint lands with
    // the steering switch-over so it can't change trigger behavior early.
    scopeKey: uuid("scope_key").notNull(),

    state: agentRunStateEnum("state").notNull().default("queued"),
    phase: agentRunPhaseEnum("phase").notNull().default("answer"),
    stopReason: agentRunStopReasonEnum("stop_reason"),

    // Event-log sequence allocator. The lease-holding worker is the sole
    // writer: it numbers events in memory from this value and persists the
    // high-water mark with each batched event flush.
    nextSeq: integer("next_seq").notNull().default(0),

    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    uniqueIndex("agent_run_messageId_uidx").on(table.messageId),
    index("agent_run_scopeKey_state_idx").on(table.scopeKey, table.state),
    index("agent_run_workspaceId_createdAt_idx").on(
      table.workspaceId,
      table.createdAt
    ),
  ]
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

export type AgentRun = typeof agentRun.$inferSelect
export type AgentRunState = (typeof agentRunStateEnum.enumValues)[number]
export type AgentRunPhase = (typeof agentRunPhaseEnum.enumValues)[number]
export type AgentRunStopReason =
  (typeof agentRunStopReasonEnum.enumValues)[number]
export type AgentRunEventKind =
  (typeof agentRunEventKindEnum.enumValues)[number]

// One shape per event kind the worker writes today; steer/queued payloads
// arrive with the steering slice.
export type AgentRunEventPayload =
  | { kind: "text"; delta: string; replace?: boolean }
  | { kind: "reasoning"; delta: string; at: number; order: number }
  | { kind: "tool"; toolCall: MerlinToolCall }
  | { kind: "memory"; path: string; action: "created" | "updated" }
  | {
      kind: "state"
      state: AgentRunState
      phase?: AgentRunPhase
      stopReason?: AgentRunStopReason
    }
  | { kind: "truncate"; contentLength: number }

export type AgentRunEvent = typeof agentRunEvent.$inferSelect
