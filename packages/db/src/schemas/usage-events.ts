import { relations } from "drizzle-orm"
import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { channel } from "./channels"
import { user } from "./users"
import { workspace } from "./workspaces"

// Append-only usage ledger. Autumn owns the credit balance; this log is ours —
// per-member/per-hall breakdowns, margin reconstruction, and future agent-run
// pricing all come from here. Never mirror the balance into it.

// merlin.* are analytics buckets, not prices — debits come from token math.
// merlin.agent is reserved for autonomous runs (defined, unpriced, unexposed).
export const operationClassEnum = pgEnum("operation_class", [
  "merlin.quick",
  "merlin.standard",
  "merlin.deep",
  "merlin.agent",
  "ingestion",
  "embedding",
  "overhead",
])

export const debitStatusEnum = pgEnum("debit_status", [
  "debited",
  "free",
  "fail_open",
])

export const usageEvent = pgTable(
  "usage_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // set null, never cascade — the ledger survives account/channel deletion.
    userId: uuid("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    channelId: uuid("channel_id").references(() => channel.id, {
      onDelete: "set null",
    }),
    operationClass: operationClassEnum("operation_class").notNull(),
    // Model actually served (gateway fallback can differ from the request).
    model: text("model"),
    requestedModel: text("requested_model"),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    // Includes reasoning tokens; reasoningTokens is the informational subset.
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    wallMs: integer("wall_ms"),
    toolCalls: integer("tool_calls"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    creditsDebited: integer("credits_debited").notNull().default(0),
    debitStatus: debitStatusEnum("debit_status").notNull().default("free"),
    // Loose reference — messages can be deleted, the ledger row stays.
    messageId: uuid("message_id"),
    idempotencyKey: text("idempotency_key"),
    rateVersion: uuid("rate_version"),
  },
  (table) => [
    index("usage_event_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt
    ),
    // Retry-safe debits: BullMQ re-runs insert the same key and skip the track.
    uniqueIndex("usage_event_idempotency_uidx").on(table.idempotencyKey),
  ]
)

export const usageEventRelations = relations(usageEvent, ({ one }) => ({
  workspace: one(workspace, {
    fields: [usageEvent.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [usageEvent.userId],
    references: [user.id],
  }),
  channel: one(channel, {
    fields: [usageEvent.channelId],
    references: [channel.id],
  }),
}))

export type UsageEventRow = typeof usageEvent.$inferSelect
export type NewUsageEventRow = typeof usageEvent.$inferInsert
