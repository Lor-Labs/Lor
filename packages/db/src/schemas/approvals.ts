import { relations, sql } from "drizzle-orm"
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
import { task } from "./tasks"
import { user } from "./users"
import { workspace } from "./workspaces"

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
])

// A consequential action an agent wants a human to authorize. Workflow-
// agnostic: a task is one anchor (taskId set), future workflows attach
// their own. For tasks, requesting one ends the run; resolution posts a
// message into the task thread, which starts the continuation run through the
// normal thread-reply path.
export const approval = pgTable(
  "approval",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // Set when a task requested it; null for other workflows.
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    // The run that requested it (audit).
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    // Machine slug for the gated action, e.g. "linear_write".
    action: text("action").notNull(),
    // Human-readable consequences, rendered on the approval card.
    description: text("description").notNull(),
    // Per-action shape; the requesting tool owns it on both write and read.
    // For policy-gated calls: the raw tool input the approval binds.
    payload: jsonb("payload").$type<unknown>(),
    // Policy-gated calls (LOR-81): the parked tool call this row authorizes.
    // All three null for discretionary request_approval rows.
    toolCallId: text("tool_call_id"),
    toolName: text("tool_name"),
    // Approval-target key that tripped the gate (@repo/connectors approval-targets).
    target: text("target"),
    status: approvalStatusEnum("status").notNull().default("pending"),
    resolvedBy: uuid("resolved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("approval_taskId_status_idx").on(table.taskId, table.status),
    index("approval_workspaceId_status_idx").on(
      table.workspaceId,
      table.status
    ),
    // At most one open approval per task — the model wraps up after asking.
    uniqueIndex("approval_task_pending_uidx")
      .on(table.taskId)
      .where(sql`status = 'pending' and task_id is not null`),
    // A run parks at its first gate — never a second pending gate per run.
    uniqueIndex("approval_run_pending_uidx")
      .on(table.runId)
      .where(sql`status = 'pending' and run_id is not null`),
  ]
)

export const approvalRelations = relations(approval, ({ one }) => ({
  workspace: one(workspace, {
    fields: [approval.workspaceId],
    references: [workspace.id],
  }),
  task: one(task, {
    fields: [approval.taskId],
    references: [task.id],
  }),
}))

export type Approval = typeof approval.$inferSelect
export type NewApproval = typeof approval.$inferInsert
export type ApprovalStatus = (typeof approvalStatusEnum.enumValues)[number]
