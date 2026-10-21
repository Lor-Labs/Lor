import { relations } from "drizzle-orm"
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { agentRun } from "./agent-runs"
import { plan } from "./plans"
import { user } from "./users"
import { workspace } from "./workspaces"

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
])

// policy: a workspace approval gate on a tool. request: Lor asked itself
// (request_approval).
export const approvalKindEnum = pgEnum("approval_kind", ["policy", "request"])

// A consequential action an agent wants a human to authorize. A Pi turn
// pauses on every gated call of its last step, so one run files a set (one
// row per call). Resolution posts nothing; when the last row of the set is
// decided, a continuation run finishes the paused turn with the decisions
// (reference/planned/pi-harness-runbook.md §4.2).
export const approval = pgTable(
  "approval",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // Set when a plan requested it; null for other workflows.
    planId: uuid("plan_id").references(() => plan.id, { onDelete: "cascade" }),
    // The run that requested it (audit).
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    kind: approvalKindEnum("kind").notNull().default("policy"),
    // Tool approval-target key, or a discretionary action slug.
    action: text("action").notNull(),
    // Human-readable consequences, rendered on the approval card.
    description: text("description").notNull(),
    // The parsed tool input the approval binds, for display.
    payload: jsonb("payload").$type<unknown>(),
    // The paused tool call this row authorizes.
    toolCallId: text("tool_call_id"),
    toolName: text("tool_name"),
    // The harness's id for the pending approval, and a sha256 of the raw
    // input it binds: the continuation runs only a matching call.
    harnessApprovalId: text("harness_approval_id"),
    inputSha256: text("input_sha256"),
    // Approval-target key that tripped the gate (@repo/connectors
    // approval-targets); null for request rows.
    target: text("target"),
    status: approvalStatusEnum("status").notNull().default("pending"),
    resolvedBy: uuid("resolved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("approval_planId_status_idx").on(table.planId, table.status),
    index("approval_workspaceId_status_idx").on(
      table.workspaceId,
      table.status
    ),
    // One row per paused call; also serves the per-run set lookups.
    uniqueIndex("approval_runId_toolCallId_uidx").on(
      table.runId,
      table.toolCallId
    ),
  ]
)

export const approvalRelations = relations(approval, ({ one }) => ({
  workspace: one(workspace, {
    fields: [approval.workspaceId],
    references: [workspace.id],
  }),
  plan: one(plan, {
    fields: [approval.planId],
    references: [plan.id],
  }),
}))

export type Approval = typeof approval.$inferSelect
export type NewApproval = typeof approval.$inferInsert
export type ApprovalStatus = (typeof approvalStatusEnum.enumValues)[number]
export type ApprovalKind = (typeof approvalKindEnum.enumValues)[number]
