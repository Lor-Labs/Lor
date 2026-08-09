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
import { channel } from "./channels"
import { message } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

// A task: a delegated outcome Merlin works toward across a chain of
// agent runs. The card message is the thread root, so the task's conversation
// scope is that thread — steering, queueing, stop, and replay reuse the
// thread-scope machinery unchanged. Never `waiting_for_*` while a run is
// active; approval and input waits happen *between* runs (a run always ends
// cleanly first).
export const taskStatusEnum = pgEnum("task_status", [
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "completed",
  "failed",
  "stopped",
])

export const task = pgTable(
  "task",
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
    // The task card message — rendered as the card in the channel feed and
    // acting as the thread root every task run executes under.
    cardMessageId: uuid("card_message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    // The originating ask, verbatim — injected into every continuation run.
    goal: text("goal").notNull(),
    status: taskStatusEnum("status").notNull().default("running"),
    plan: jsonb("plan").$type<TaskPlanItem[]>().notNull().default([]),
    // Set by the complete_task tool; a run ending without it parks the task
    // in waiting_for_input instead.
    summary: text("summary"),
    activeRunId: uuid("active_run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    // Railway checkpoint holding the task's last workbench disk (the
    // sub-agent's scripts and scratch state). A cache, not truth — losing it
    // degrades a follow-up edit to a cold start, nothing worse.
    sandboxCheckpoint: text("sandbox_checkpoint"),
  },
  (table) => [
    uniqueIndex("task_cardMessageId_uidx").on(table.cardMessageId),
    index("task_channelId_status_idx").on(table.channelId, table.status),
    index("task_workspaceId_createdAt_idx").on(
      table.workspaceId,
      table.createdAt
    ),
  ]
)

export const taskRelations = relations(task, ({ one }) => ({
  workspace: one(workspace, {
    fields: [task.workspaceId],
    references: [workspace.id],
  }),
  channel: one(channel, {
    fields: [task.channelId],
    references: [channel.id],
  }),
  cardMessage: one(message, {
    fields: [task.cardMessageId],
    references: [message.id],
  }),
}))

export type TaskPlanItem = {
  text: string
  status: "pending" | "active" | "done"
}

export type Task = typeof task.$inferSelect
export type NewTask = typeof task.$inferInsert
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number]
