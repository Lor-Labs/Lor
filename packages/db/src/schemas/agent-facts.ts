import { sql } from "drizzle-orm"
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { agent } from "./agents"
import { channel } from "./channels"
import { user } from "./users"
import { workspace } from "./workspaces"

// The facts an agent keeps (reference/always-on-agents.md §7): short,
// durable information the memory pass saves after each turn, each with where
// it came from. They belong to the agent and follow it to every channel
// (reference/agents-and-chats.md). People edit or delete them in the agent's
// settings. A deleted fact keeps its row so the next turn's change note can
// say it is gone.
export const agentFact = pgTable(
  "agent_fact",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    // The channel whose turn learned it. Kept for the record only.
    channelId: uuid("channel_id").references(() => channel.id, {
      onDelete: "set null",
    }),
    text: text("text").notNull(),
    // Who said it, or which webhook, issue or session it came from.
    source: text("source").notNull(),
    // The person who last edited or deleted it; null when the memory pass did.
    editedById: uuid("edited_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("agent_fact_live_idx")
      .on(table.agentId, table.createdAt)
      .where(sql`deleted_at is null`),
    index("agent_fact_agent_updated_idx").on(table.agentId, table.updatedAt),
  ]
)

export type AgentFact = typeof agentFact.$inferSelect
