import { sql } from "drizzle-orm"
import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { agent } from "./agents"
import { channel } from "./channels"
import { message } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

// "own": the one conversation an agent has with itself, for what nobody
// asked for (its check-in, loops, events, its wake-ups). "request": one
// thing a person addressed to it.
export const agentConversationKindEnum = pgEnum("agent_conversation_kind", [
  "own",
  "request",
])

// An agent's conversations (reference/agents-and-chats.md, decision 28).
// Each has its own inbox, stored steps, context and queue, so requests run
// side by side and nobody waits behind background work. What makes them one
// agent is the memory under all of them (agent-memory.ts), not a shared
// transcript.
export const agentConversation = pgTable(
  "agent_conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    kind: agentConversationKindEnum("kind").notNull(),
    // A request's channel. Null for the agent's own conversation, which
    // spans every channel it is in.
    channelId: uuid("channel_id").references(() => channel.id, {
      onDelete: "cascade",
    }),
    // The message a request started from: the one that addressed the agent,
    // or the root of the thread it was addressed in. Messages in the thread
    // under it belong to this conversation. Null for a channel's history
    // from before conversations, kept to read.
    rootMessageId: uuid("root_message_id").references(() => message.id, {
      onDelete: "cascade",
    }),
    startedById: uuid("started_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // The own conversation's last check-in.
    checkedInAt: timestamp("checked_in_at"),
    lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_conversation_own_uidx")
      .on(table.agentId)
      .where(sql`kind = 'own'`),
    uniqueIndex("agent_conversation_root_uidx")
      .on(table.agentId, table.rootMessageId)
      .where(sql`root_message_id is not null`),
    index("agent_conversation_channel_idx").on(table.channelId),
  ]
)

// The agent's posts in a channel's chat (not in a thread), by the request
// that made them: a reply or a thread under one continues that request
// instead of starting another.
export const agentConversationPost = pgTable(
  "agent_request_post",
  {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => message.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => agentConversation.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("agent_request_post_conversation_idx").on(table.conversationId),
  ]
)

export type AgentConversation = typeof agentConversation.$inferSelect
