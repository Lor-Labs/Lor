import { relations } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { agentConversation } from "./agent-conversations"
import { agentRun } from "./agent-runs"
import { workspace } from "./workspaces"

// One model message as the AI SDK sends it ({ role, content }). Kept loose so
// the db package needs no AI SDK dependency.
export type AgentStepMessage = { role: string; content: unknown }

export const agentStepKindEnum = pgEnum("agent_step_kind", [
  // What starts a turn: the time and the inbox batch.
  "inbox",
  // One model call's reply: its text, reasoning and tool calls.
  "model",
  // Tool results, or the decisions on calls that waited for approval.
  "tools",
  // Opens an epoch after compaction: the summary and the latest messages.
  "summary",
])

// One of an agent's conversations (agent-conversations.ts), one model
// message per row (reference/always-on-agents.md §4, §8). Append-only and
// never pruned:
// compaction starts a new epoch, and the agent reads older epochs back with
// read_agent_history.
export const agentStep = pgTable(
  "agent_step",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => agentConversation.id, { onDelete: "cascade" }),
    epoch: integer("epoch").notNull(),
    // Order within the conversation, across epochs.
    seq: integer("seq").notNull(),
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    kind: agentStepKindEnum("kind").notNull(),
    message: jsonb("message").$type<AgentStepMessage>().notNull(),
    // Plain text of the step, for read_agent_history.
    text: text("text").notNull().default(""),
  },
  (table) => [
    uniqueIndex("agent_step_conversation_seq_uidx").on(
      table.conversationId,
      table.seq
    ),
    index("agent_step_conversation_epoch_idx").on(
      table.conversationId,
      table.epoch,
      table.seq
    ),
    index("agent_step_run_idx").on(table.runId),
  ]
)

// One row per conversation: the epoch it is on and the prompt top that stays
// byte-identical until the next compaction, so the provider's cache holds.
export const agentContext = pgTable("agent_context", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => agentConversation.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  epoch: integer("epoch").notNull().default(0),
  // The system prompt for this epoch. Null until its first turn builds it.
  system: text("system"),
  // The epoch's tool set and model, to log what broke the cache.
  toolsHash: text("tools_hash"),
  model: text("model"),
  // Reasoning from steps up to this seq is left out of the prompt: their
  // signatures name a tool set or model the epoch no longer has.
  reasoningCutSeq: integer("reasoning_cut_seq"),
  // Input tokens of the last model call: the prompt's size.
  promptTokens: integer("prompt_tokens").notNull().default(0),
  lastTurnEndedAt: timestamp("last_turn_ended_at"),
  compactedAt: timestamp("compacted_at"),
  // Profile changes up to here have reached the agent, in its system prompt
  // or a turn's change note.
  notesThrough: timestamp("notes_through"),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const agentStepRelations = relations(agentStep, ({ one }) => ({
  conversation: one(agentConversation, {
    fields: [agentStep.conversationId],
    references: [agentConversation.id],
  }),
  run: one(agentRun, {
    fields: [agentStep.runId],
    references: [agentRun.id],
  }),
}))

export type AgentStep = typeof agentStep.$inferSelect
export type AgentStepKind = (typeof agentStepKindEnum.enumValues)[number]
export type AgentContext = typeof agentContext.$inferSelect
