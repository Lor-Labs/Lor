import { sql } from "drizzle-orm"
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { channel } from "./channels"
import { user } from "./users"
import { workspace } from "./workspaces"

// The facts in a channel agent's profile (reference/always-on-agents.md §7):
// short, durable information the memory pass keeps after each turn, each
// with where it came from. People edit or delete them in the channel's
// settings. A deleted fact keeps its row so the next turn's change note can
// say it is gone.
export const channelAgentFact = pgTable(
  "channel_agent_fact",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
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
    index("channel_agent_fact_live_idx")
      .on(table.channelId, table.createdAt)
      .where(sql`deleted_at is null`),
    index("channel_agent_fact_channel_updated_idx").on(
      table.channelId,
      table.updatedAt
    ),
  ]
)

export type ChannelAgentFact = typeof channelAgentFact.$inferSelect
