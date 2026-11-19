import { relations, sql } from "drizzle-orm"
import {
  index,
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
import { workspace } from "./workspaces"

// What an inbox item is about. A chat message today; webhooks, Loops and
// finished sessions join in later steps (reference/always-on-agents.md
// §3).
export const agentInboxSourceEnum = pgEnum("agent_inbox_source", ["message"])

// "wake" starts the channel agent's next turn. "wait" sits unread until
// something else wakes it.
export const agentInboxLaneEnum = pgEnum("agent_inbox_lane", ["wake", "wait"])

export const agentInboxStatusEnum = pgEnum("agent_inbox_status", [
  "pending",
  "read",
])

// The channel agent's inbox: everything that can concern it lands here, and
// nothing calls the agent directly. One worker per channel reads pending rows
// in a batch and starts one turn for them.
export const agentInbox = pgTable(
  "agent_inbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    source: agentInboxSourceEnum("source").notNull(),
    // The source's own id for the item (a message id): duplicates are dropped.
    sourceId: text("source_id").notNull(),
    lane: agentInboxLaneEnum("lane").notNull(),
    // The chat message the item is about.
    messageId: uuid("message_id").references(() => message.id, {
      onDelete: "cascade",
    }),
    status: agentInboxStatusEnum("status").notNull().default("pending"),
    readAt: timestamp("read_at"),
    // The agent turn that read this item.
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("agent_inbox_channel_source_uidx").on(
      table.channelId,
      table.source,
      table.sourceId
    ),
    index("agent_inbox_channel_pending_idx")
      .on(table.channelId, table.createdAt)
      .where(sql`status = 'pending'`),
  ]
)

export const agentInboxRelations = relations(agentInbox, ({ one }) => ({
  channel: one(channel, {
    fields: [agentInbox.channelId],
    references: [channel.id],
  }),
  message: one(message, {
    fields: [agentInbox.messageId],
    references: [message.id],
  }),
}))

export type AgentInboxItem = typeof agentInbox.$inferSelect
export type AgentInboxLane = (typeof agentInboxLaneEnum.enumValues)[number]
