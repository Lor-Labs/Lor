import { relations, sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { channel } from "./channels"
import { connectorTrigger } from "./connector-triggers"
import { loop } from "./loops"
import { message } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

export const agentSessionOriginEnum = pgEnum("agent_session_origin", [
  // `@Lor` in channel chat, or "Ask Lor about this" on a message.
  "chat",
  // The New session view.
  "new",
  "loop",
  "trigger",
])

// Fixed when the session starts (reference/planned/code-channels.md §2).
export const agentSessionModeEnum = pgEnum("agent_session_mode", [
  "chat",
  "code",
])

// Harnesses that can run a conversation (reference/planned/harness-sessions.md
// §3). Claude Code runs on the turn starter's own Claude subscription
// (code-sessions-runbook.md chunk 7); Codex on Lor credits (chunk 8).
// Defined here, not in harness-states.ts, which imports this file.
export const harnessKindEnum = pgEnum("harness_kind", [
  "pi",
  "claude_code",
  "codex",
])

// A Lor session: one place where Lor works on one thing, next to the channel
// chat (reference/workspace-model.md). Its anchor message (type
// "agent_session") never shows in chat; session messages are thread replies
// under it, so runs, plans and sandboxes key on threadRootId as before.
export const agentSession = pgTable(
  "agent_session",
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
    threadRootId: uuid("thread_root_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    // Null for loop and trigger sessions.
    creatorId: uuid("creator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    origin: agentSessionOriginEnum("origin").notNull(),
    mode: agentSessionModeEnum("mode").notNull().default("chat"),
    // Fixed when the session starts: each harness keeps its own native
    // conversation, so a session never switches.
    harness: harnessKindEnum("harness").notNull().default("pi"),
    // Code sessions: the GitHub repo (owner/repo) cloned as the work folder
    // and the branch it starts from. Null in chat sessions.
    repoFullName: text("repo_full_name"),
    baseBranch: text("base_branch"),
    // A branch the session made from baseBranch at its start, pushed to
    // GitHub by the session's first push. Null: it works on baseBranch.
    newBranch: text("new_branch"),
    // The sidebar's +/− for a code session: uncommitted lines against HEAD,
    // the Changes panel's total. Saved when a sandbox is already open; null
    // until first counted.
    uncommittedAdditions: integer("uncommitted_additions"),
    uncommittedDeletions: integer("uncommitted_deletions"),
    // "Continue in Code": the session this one continues, whose messages are
    // its starting context.
    sourceSessionId: uuid("source_session_id").references(
      (): AnyPgColumn => agentSession.id,
      { onDelete: "set null" }
    ),
    // A fork: the Lor reply in the source session whose turn it starts from
    // (code-sessions-runbook.md chunk 6).
    forkedFromMessageId: uuid("forked_from_message_id").references(
      () => message.id,
      { onDelete: "set null" }
    ),
    title: text("title").notNull(),
    // Set when a person renames the session; generated titles stop then.
    titleEditedAt: timestamp("title_edited_at"),
    loopId: uuid("loop_id").references(() => loop.id, {
      onDelete: "set null",
    }),
    triggerId: uuid("trigger_id").references(() => connectorTrigger.id, {
      onDelete: "set null",
    }),
    // Archive is for everyone. A loop's next run clears it.
    archivedAt: timestamp("archived_at"),
    archivedById: uuid("archived_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_session_threadRootId_uidx").on(table.threadRootId),
    uniqueIndex("agent_session_loopId_uidx")
      .on(table.loopId)
      .where(sql`loop_id is not null`),
    index("agent_session_channelId_lastActivityAt_idx").on(
      table.channelId,
      table.lastActivityAt
    ),
  ]
)

// The messages a session was started with: chat history before `@Lor`, the
// message behind "Ask Lor about this", or a thread's replies. Written once at
// session start; renders as the "From #channel" block and is the background
// Lor reads. What Lor reads later is in the session's Pi log (harness_log).
export const agentSessionContext = pgTable(
  "agent_session_context",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSession.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("agent_session_context_sessionId_messageId_uidx").on(
      table.sessionId,
      table.messageId
    ),
    index("agent_session_context_messageId_idx").on(table.messageId),
  ]
)

export const agentSessionRelations = relations(
  agentSession,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [agentSession.workspaceId],
      references: [workspace.id],
    }),
    channel: one(channel, {
      fields: [agentSession.channelId],
      references: [channel.id],
    }),
    threadRoot: one(message, {
      fields: [agentSession.threadRootId],
      references: [message.id],
    }),
    loop: one(loop, {
      fields: [agentSession.loopId],
      references: [loop.id],
    }),
    context: many(agentSessionContext),
  })
)

export const agentSessionContextRelations = relations(
  agentSessionContext,
  ({ one }) => ({
    session: one(agentSession, {
      fields: [agentSessionContext.sessionId],
      references: [agentSession.id],
    }),
    message: one(message, {
      fields: [agentSessionContext.messageId],
      references: [message.id],
    }),
  })
)

export type AgentSession = typeof agentSession.$inferSelect
export type NewAgentSession = typeof agentSession.$inferInsert
