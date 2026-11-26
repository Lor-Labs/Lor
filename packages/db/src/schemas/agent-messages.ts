import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { agentConversation } from "./agent-conversations"
import { agent } from "./agents"
import { channel } from "./channels"
import { workspace } from "./workspaces"

// What a chat's agents say to each other about its work
// (reference/agents-and-chats.md, decisions 39 and 44): the agents' own
// chat, which people read and don't write in. It works as a chat does: a
// post names the agents it is for, names nobody, or is for everyone. It is not a `message`: nothing here is in
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
    // The agents it names, who are woken with it. Empty: it names nobody,
    // and the agent it reads as meant for is woken (Jev), unless
    // `toEveryone`, which wakes them all. The others read it at their
    // check-in. No foreign key: an agent deleted since stays as an id.
    toAgentIds: uuid("to_agent_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    toEveryone: boolean("to_everyone").notNull().default(false),
    // The post it answers, shown as a reply to it: what the agent passed as
    // `replyTo`, never inferred. Null: it did not say it was answering one.
    // No foreign key: a post is only ever deleted with its chat.
    replyToId: uuid("reply_to_id"),
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
