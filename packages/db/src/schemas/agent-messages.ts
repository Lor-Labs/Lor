import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { agentConversation } from "./agent-conversations"
import { agent } from "./agents"
import { channel } from "./channels"
import { workspace } from "./workspaces"

// What one agent said to another about a chat's work
// (reference/agents-and-chats.md, decision 39): the agents' own chat, which
// people read and don't write in. It is not a `message`: nothing here is in
// the chat's feed, its unread counts, search or notifications. The feed gets
// one "agent_messaged" line, which opens this.
export const agentMessage = pgTable(
  "agent_message",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // The chat both agents are in, whose work this is about.
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    fromAgentId: uuid("from_agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    toAgentId: uuid("to_agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    // The sender's conversation it was written in: an answer goes back
    // there, so the sender reads it where it has the context.
    fromConversationId: uuid("from_conversation_id").references(
      () => agentConversation.id,
      { onDelete: "set null" }
    ),
    content: text("content").notNull(),
  },
  (table) => [
    index("agent_message_channel_created_idx").on(
      table.channelId,
      table.createdAt
    ),
  ]
)

export type AgentMessage = typeof agentMessage.$inferSelect
