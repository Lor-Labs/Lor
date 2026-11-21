import { sql } from "drizzle-orm"
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { agentRun } from "./agent-runs"
import { channel } from "./channels"
import { user } from "./users"
import { workspace } from "./workspaces"

export const agentWakeUpStatusEnum = pgEnum("agent_wake_up_status", [
  "pending",
  "fired",
  "cancelled",
])

// A wake-up the channel agent set for itself with `wake_up`
// (reference/always-on-agents.md, decision 10): at `dueAt` the sweep puts its
// note in the channel's inbox, in the wake lane. Separate from Loops, which
// people set up and which repeat.
export const agentWakeUp = pgTable(
  "agent_wake_up",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at").notNull(),
    // The agent's note to its future self.
    note: text("note").notNull(),
    // The turn that set it, and the person who woke that turn: approvals on
    // the turn it starts ask them.
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    askedById: uuid("asked_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    status: agentWakeUpStatusEnum("status").notNull().default("pending"),
    firedAt: timestamp("fired_at"),
    cancelledAt: timestamp("cancelled_at"),
    // A person who cancelled it; null when the agent did.
    cancelledById: uuid("cancelled_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("agent_wake_up_due_idx")
      .on(table.dueAt)
      .where(sql`status = 'pending'`),
    index("agent_wake_up_channel_idx").on(table.channelId, table.status),
  ]
)

export type AgentWakeUp = typeof agentWakeUp.$inferSelect
