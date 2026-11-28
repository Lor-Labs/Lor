import { relations } from "drizzle-orm"
import {
  boolean,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { createSelectSchema } from "drizzle-zod"
import { agentProfile } from "./agent-profiles"
import { channel } from "./channels"
import { personalAccount } from "./personal-accounts"
import { user } from "./users"
import { workspace } from "./workspaces"

// An always-on agent: a teammate for one role, with its own name, face,
// brief, model and memory, added to channels (reference/agents-and-chats.md).
// Which channels it is in is `channel_agent`. Every workspace member sees
// every agent; what it learns in a private channel stays there by scope
// (`agent_fact.scope_channel_id`), not by hiding the agent.
export const agent = pgTable(
  "agent",
  {
    // Also the id of its bot user (`user.is_bot`), made with it by
    // createAgent: the author of its messages and what a mention of it
    // holds (reference/agents-and-chats.md, decision 37). Deleting the
    // agent leaves that user, so its messages keep their author.
    id: uuid("id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // A creature id from @repo/utils/bestiary: the face it is drawn with.
    creature: text("creature").notNull(),
    identityUpdatedAt: timestamp("identity_updated_at"),
    // What it looks after, in a few words ("Eng"): shown beside its name.
    role: text("role"),
    // Standing instructions only people write, in its system prompt in every
    // channel. Every member can read it: instructions for one private
    // channel go on that channel's row (`channel_agent.brief`).
    brief: text("brief"),
    briefUpdatedAt: timestamp("brief_updated_at"),
    // The model for its own turns when it runs as Lor, in the composer's
    // syntax: a Lor model, or `key:provider/model` to pay with the
    // workspace's own API key. Null = the default.
    model: text("model"),
    // What it may use: its tool profile, wherever it works (its chats, a
    // Loop with no chat, Discord) and in the sessions it starts. Null = the
    // workspace default (reference/agents-and-chats.md, decision 53).
    agentProfileId: uuid("agent_profile_id").references(() => agentProfile.id, {
      onDelete: "set null",
    }),
    createdById: uuid("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("agent_workspaceId_idx").on(table.workspaceId)]
)

export const agentRelations = relations(agent, ({ one }) => ({
  workspace: one(workspace, {
    fields: [agent.workspaceId],
    references: [workspace.id],
  }),
}))

export type Agent = typeof agent.$inferSelect

// The agents in a channel. The shape allows several; the app holds a channel
// to one for now (MAX_CHANNEL_AGENTS in constants.ts). A channel with no
// row is plain human chat that wakes nothing.
export const channelAgent = pgTable(
  "channel_agent",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    addedById: uuid("added_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Instructions for this agent in this channel only, written by people
    // and read only by those who can see the channel. Where a private
    // channel's instructions live, since the agent's own brief is public.
    brief: text("brief"),
    briefUpdatedAt: timestamp("brief_updated_at"),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.agentId] }),
    index("channel_agent_agentId_idx").on(table.agentId),
  ]
)

// How an agent's work is paid for when nobody's own plan does: work nobody
// asked for, and requests from people with no plan linked
// (reference/agents-and-chats.md, decision 7; reference/harness-accounts.md).
// No row = the defaults: Lor's own agent on Lor credits. The accounts are
// the workspace's (`personal_account.workspace_id`); each agent picks its own.
export const agentHarnessSettings = pgTable(
  "agent_harness_settings",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agent.id, { onDelete: "cascade" }),
    defaultHarness: text("default_harness", {
      enum: ["pi", "claude_code", "codex"],
    })
      .notNull()
      .default("pi"),
    claudeApiBilling: text("claude_api_billing", { enum: ["lor", "byok"] })
      .notNull()
      .default("lor"),
    codexApiBilling: text("codex_api_billing", { enum: ["lor", "byok"] })
      .notNull()
      .default("lor"),
    claudeAccountId: uuid("claude_account_id"),
    codexAccountId: uuid("codex_account_id"),
    claudeUseSubscriptions: boolean("claude_use_subscriptions")
      .notNull()
      .default(false),
    codexUseSubscriptions: boolean("codex_use_subscriptions")
      .notNull()
      .default(false),
    claudeAutoFallback: boolean("claude_auto_fallback").notNull().default(true),
    codexAutoFallback: boolean("codex_auto_fallback").notNull().default(true),
  },
  (table) => [
    // Explicit names: the auto-generated ones exceed Postgres's 63-byte limit.
    foreignKey({
      columns: [table.claudeAccountId],
      foreignColumns: [personalAccount.id],
      name: "agent_harness_settings_claude_account_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.codexAccountId],
      foreignColumns: [personalAccount.id],
      name: "agent_harness_settings_codex_account_fk",
    }).onDelete("set null"),
  ]
)

export const selectAgentSchema = createSelectSchema(agent)
