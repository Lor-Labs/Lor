import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { agentRun } from "./agent-runs"
import { agentSession } from "./agent-sessions"
import { agent } from "./agents"
import { channel } from "./channels"
import { user } from "./users"
import { workspace } from "./workspaces"

// An agent's journal (reference/agents-and-chats.md, decision 25): a dated
// entry after a turn worth one, saying where, with whom and what was said or
// decided. One journal per agent, written from every conversation it has (a
// channel, a code session), so a turn in one place knows what happened in
// the others. Recent entries are in the prompt; older ones are found by
// `recall`. Shared with the whole workspace, like its facts.
export const agentJournal = pgTable(
  "agent_journal",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    // Where it happened: the channel, and the code session when it was one.
    channelId: uuid("channel_id").references(() => channel.id, {
      onDelete: "set null",
    }),
    sessionId: uuid("session_id").references(() => agentSession.id, {
      onDelete: "set null",
    }),
    // The turn it describes: one entry per turn.
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    // The person the turn was for; null for work nobody asked for. Their
    // entries come first when that person talks to the agent again.
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    text: text("text").notNull(),
  },
  (table) => [
    index("agent_journal_agent_created_idx").on(table.agentId, table.createdAt),
    uniqueIndex("agent_journal_runId_uidx").on(table.runId),
  ]
)

export type AgentJournalEntry = typeof agentJournal.$inferSelect
