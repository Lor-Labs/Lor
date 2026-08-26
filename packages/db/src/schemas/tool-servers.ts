import { relations, sql } from "drizzle-orm"
import {
  check,
  index,
  jsonb,
  pgEnum,
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

// A remote MCP tool server the workspace connected over Streamable HTTP.
// Unlike custom_tool rows, the server owns its live tool list
// and schemas; `enabledTools` is the workspace's allowlist over it so an
// upstream tool addition can't silently widen Merlin's surface. Sessions are
// created per respond() call (the datadogMcpTools pattern, generalized).
// See reference/automation-primitives.md §4.
export const toolServerAuthModeEnum = pgEnum("tool_server_auth_mode", [
  "static",
  "oauth",
])

export type ToolServerAuthMode =
  (typeof toolServerAuthModeEnum.enumValues)[number]

export const toolServerOAuthStatusEnum = pgEnum("tool_server_oauth_status", [
  "pending",
  "needs_tool_review",
  "connected",
  "reauthorization_required",
])

export type ToolServerOAuthStatus =
  (typeof toolServerOAuthStatusEnum.enumValues)[number]

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
    // `static` covers no-auth and user-supplied header/API-key auth. OAuth is
    // workspace-scoped: the authorizing member is audit provenance only.
    authMode: toolServerAuthModeEnum("auth_mode").notNull().default("static"),
    oauthStatus: toolServerOAuthStatusEnum("oauth_status"),
    // One AES-256-GCM ciphertext containing the versioned OAuth token/client/
    // authorization-server envelope. Never serialized through the API.
    oauthCredentials: text("oauth_credentials"),
    oauthAuthorizedBy: uuid("oauth_authorized_by").references(() => user.id, {
      onDelete: "set null",
    }),
    oauthAuthorizedAt: timestamp("oauth_authorized_at"),
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
    index("tool_server_oauth_authorized_by_idx").on(table.oauthAuthorizedBy),
    check(
      "tool_server_auth_status_check",
      sql`(${table.authMode} = 'static' AND ${table.oauthStatus} IS NULL AND ${table.oauthCredentials} IS NULL AND ${table.oauthAuthorizedBy} IS NULL AND ${table.oauthAuthorizedAt} IS NULL) OR (${table.authMode} = 'oauth' AND ${table.oauthStatus} IS NOT NULL)`
    ),
    check(
      "tool_server_oauth_connected_credentials_check",
      sql`${table.oauthStatus} NOT IN ('needs_tool_review', 'connected') OR (${table.oauthCredentials} IS NOT NULL AND ${table.oauthAuthorizedAt} IS NOT NULL)`
    ),
  ]
)

// Short-lived, single-use state for an interactive OAuth attempt. State and
// PKCE verifier are encrypted; stateHash is the only callback lookup key.
// At most one unconsumed attempt may exist for a server.
export const toolServerOAuthAttempt = pgTable(
  "tool_server_oauth_attempt",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    toolServerId: uuid("tool_server_id")
      .notNull()
      .references(() => toolServer.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    initiatedBy: uuid("initiated_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stateHash: text("state_hash").notNull(),
    encryptedState: text("encrypted_state").notNull(),
    encryptedCodeVerifier: text("encrypted_code_verifier").notNull(),
  },
  (table) => [
    uniqueIndex("tool_server_oauth_attempt_state_hash_uidx").on(
      table.stateHash
    ),
    uniqueIndex("tool_server_oauth_attempt_live_server_uidx")
      .on(table.toolServerId)
      .where(sql`${table.consumedAt} IS NULL`),
    index("tool_server_oauth_attempt_workspace_idx").on(table.workspaceId),
    index("tool_server_oauth_attempt_expires_idx").on(table.expiresAt),
    check(
      "tool_server_oauth_attempt_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "tool_server_oauth_attempt_consumed_check",
      sql`${table.consumedAt} IS NULL OR ${table.consumedAt} >= ${table.createdAt}`
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
  oauthAuthorizer: one(user, {
    fields: [toolServer.oauthAuthorizedBy],
    references: [user.id],
  }),
  oauthAttempts: many(toolServerOAuthAttempt),
  profileGrants: many(agentProfileToolServer),
}))

export const toolServerOAuthAttemptRelations = relations(
  toolServerOAuthAttempt,
  ({ one }) => ({
    toolServer: one(toolServer, {
      fields: [toolServerOAuthAttempt.toolServerId],
      references: [toolServer.id],
    }),
    workspace: one(workspace, {
      fields: [toolServerOAuthAttempt.workspaceId],
      references: [workspace.id],
    }),
    initiator: one(user, {
      fields: [toolServerOAuthAttempt.initiatedBy],
      references: [user.id],
    }),
  })
)

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
export type ToolServerOAuthAttempt = typeof toolServerOAuthAttempt.$inferSelect
export type NewToolServerOAuthAttempt =
  typeof toolServerOAuthAttempt.$inferInsert
