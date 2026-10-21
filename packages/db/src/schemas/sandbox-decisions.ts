import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { agentRun } from "./agent-runs"
import { workspace } from "./workspaces"

export const turnSandboxModeEnum = pgEnum("turn_sandbox_mode", [
  "manual",
  "auto",
  "bypass",
  "autonomous",
])
export const sandboxCheckEnum = pgEnum("sandbox_check", [
  "hard",
  "flagged",
  "safe",
  "routine",
])
export const sandboxOutcomeEnum = pgEnum("sandbox_outcome", [
  "allow",
  "ask",
  "deny",
])

// Every `bash`, `write` and `edit` decision of the sandbox policy: the call,
// how the rules classed it, and what the turn's mode did with it. A person's
// answer to an ask is the matching `sandbox` approval row (same tool call).
// Feeds tuning and the classifier eval
// (reference/planned/pi-harness-runbook.md §4.6).
export const sandboxDecision = pgTable(
  "sandbox_decision",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    // The command or file path judged, bounded.
    subject: text("subject").notNull(),
    mode: turnSandboxModeEnum("mode").notNull(),
    check: sandboxCheckEnum("check").notNull(),
    outcome: sandboxOutcomeEnum("outcome").notNull(),
    reason: text("reason"),
  },
  (table) => [
    index("sandbox_decision_runId_idx").on(table.runId),
    index("sandbox_decision_workspaceId_createdAt_idx").on(
      table.workspaceId,
      table.createdAt
    ),
  ]
)

export type SandboxDecision = typeof sandboxDecision.$inferSelect
// A person's sandbox mode, or autonomous for Loop and Act runs (no one to ask).
export type TurnSandboxMode = (typeof turnSandboxModeEnum.enumValues)[number]
