import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { agentRun } from "./agent-runs"
import { workspace } from "./workspaces"

// Only model decisions need a separate audit: rules can be recomputed from
// harness_log, but classifier answers cannot (pi-harness-runbook.md §4.6).
export const sandboxClassification = pgTable(
  "sandbox_classification",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    model: text("model").notNull(),
    policyVersion: text("policy_version").notNull(),
    inputSha256: text("input_sha256").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    answers: jsonb("answers").$type<Record<string, unknown>>(),
    thresholds: jsonb("thresholds").$type<Record<string, number>>().notNull(),
    outcome: text("outcome").$type<"allow" | "ask" | "deny">().notNull(),
    reason: text("reason").notNull(),
    error: text("error"),
    costUsd: numeric("cost_usd", { precision: 16, scale: 10 }),
    wallMs: integer("wall_ms").notNull(),
  },
  (table) => [
    index("sandbox_classification_runId_idx").on(table.runId, table.toolCallId),
  ]
)
