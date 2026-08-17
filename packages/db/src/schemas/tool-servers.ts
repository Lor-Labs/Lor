import { relations } from "drizzle-orm"
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { agentProfile } from "./agent-profiles"
import { user } from "./users"
import { workspace } from "./workspaces"

// A remote MCP tool server the workspace connected (Streamable HTTP + static
// header auth). Unlike custom_tool rows, the server owns its live tool list
// and schemas; `enabledTools` is the workspace's allowlist over it so an
// upstream tool addition can't silently widen Merlin's surface. Sessions are
// created per respond() call (the datadogMcpTools pattern, generalized).
// See reference/automation-primitives.md §4.
export const toolServer = pgTable(
  "tool_server",
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
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    // Display name ("Sentry MCP") — not model-facing; tool names come from
    // the server.
    name: text("name").notNull(),
    // Workspace context the vendor's tool descriptions can't know ("our
    // production Postgres — use for signup/usage questions"); injected into
    // Merlin's system prompt next to the server name.
    description: text("description").notNull().default(""),
    // https Streamable HTTP endpoint; same SSRF stance as custom tools,
    // checked at create AND connect time.
    url: text("url").notNull(),
    // Header name → value; values may reference {{secrets.KEY}}.
    headers: jsonb("headers").$type<Record<string, string>>().notNull(),
    // Secret name → AES-256-GCM ciphertext, write-only through the API.
    secrets: jsonb("secrets").$type<Record<string, string>>().notNull(),
    // Allowlist of server tool names Merlin may bind. Empty = none.
    enabledTools: text("enabled_tools").array().notNull().default([]),
  },
  (table) => [
    uniqueIndex("tool_server_workspace_name_uidx").on(
      table.workspaceId,
      table.name
    ),
  ]
)

// Per-profile server grants (used when the profile lacks the blanket
// `custom_tools` capability) — same shape and rationale as
// agent_profile_custom_tool: cascade cleanup, indexed reverse lookup.
export const agentProfileToolServer = pgTable(
  "agent_profile_tool_server",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => agentProfile.id, { onDelete: "cascade" }),
    toolServerId: uuid("tool_server_id")
      .notNull()
      .references(() => toolServer.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.toolServerId] }),
    index("agent_profile_tool_server_server_idx").on(table.toolServerId),
  ]
)

export const toolServerRelations = relations(toolServer, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [toolServer.workspaceId],
    references: [workspace.id],
  }),
  profileGrants: many(agentProfileToolServer),
}))

export const agentProfileToolServerRelations = relations(
  agentProfileToolServer,
  ({ one }) => ({
    profile: one(agentProfile, {
      fields: [agentProfileToolServer.profileId],
      references: [agentProfile.id],
    }),
    toolServer: one(toolServer, {
      fields: [agentProfileToolServer.toolServerId],
      references: [toolServer.id],
    }),
  })
)

export type ToolServer = typeof toolServer.$inferSelect
export type NewToolServer = typeof toolServer.$inferInsert
