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
import { channel } from "./channels"
import { message } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

// A plan: a delegated outcome Merlin works toward across a chain of
// agent runs. The plan anchors to a thread root, so its conversation scope is
// that thread — steering, queueing, stop, and replay reuse the thread-scope
// machinery unchanged. Never `waiting_for_*` while a run is active; approval
// and input waits happen *between* runs (a run always ends cleanly first).
export const planStatusEnum = pgEnum("plan_status", [
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "completed",
  "failed",
  "stopped",
])

export const plan = pgTable(
  "plan",
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
    // The thread root every plan run executes under — the plan's conversation
    // scope (plan.threadRootId = agent_run.scopeKey).
    threadRootId: uuid("thread_root_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    // The plan card message rendered in the channel feed — a projection of the
    // plan, not its anchor. Spawned plans (loops/Act) keep card-as-root, so it
    // can equal threadRootId.
    cardMessageId: uuid("card_message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    creatorId: uuid("creator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    // The originating ask, verbatim — injected into every continuation run.
    goal: text("goal").notNull(),
    status: planStatusEnum("status").notNull().default("running"),
    steps: jsonb("steps").$type<PlanStep[]>().notNull().default([]),
    // Set by the complete_plan tool; a run ending without it parks the plan
    // in waiting_for_input instead.
    summary: text("summary"),
    activeRunId: uuid("active_run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    // Provenance: the agent run whose create_plan spawned this plan (Act
    // trigger or loop runs). Null for human/conversational creation. Loop
    // → spawned plans resolves through agent_run.loopId + this.
    originRunId: uuid("origin_run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("plan_threadRootId_uidx").on(table.threadRootId),
    uniqueIndex("plan_cardMessageId_uidx")
      .on(table.cardMessageId)
      .where(sql`card_message_id is not null`),
    index("plan_channelId_status_idx").on(table.channelId, table.status),
    index("plan_workspaceId_createdAt_idx").on(
      table.workspaceId,
      table.createdAt
    ),
    index("plan_originRunId_idx").on(table.originRunId),
  ]
)

export const planRelations = relations(plan, ({ one }) => ({
  workspace: one(workspace, {
    fields: [plan.workspaceId],
    references: [workspace.id],
  }),
  channel: one(channel, {
    fields: [plan.channelId],
    references: [channel.id],
  }),
  threadRoot: one(message, {
    fields: [plan.threadRootId],
    references: [message.id],
    relationName: "planThreadRoot",
  }),
  cardMessage: one(message, {
    fields: [plan.cardMessageId],
    references: [message.id],
    relationName: "planCardMessage",
  }),
}))

export type PlanStep = {
  text: string
  status: "pending" | "active" | "done"
  // One short clause of extra context, when the label alone isn't enough.
  // Absent on most items — the card renders it as a muted second line.
  description?: string
}

export type Plan = typeof plan.$inferSelect
export type NewPlan = typeof plan.$inferInsert
export type PlanStatus = (typeof planStatusEnum.enumValues)[number]
