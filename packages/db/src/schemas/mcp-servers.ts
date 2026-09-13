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

// A remote MCP server the workspace connected over Streamable HTTP.
// Unlike custom_tool rows, the server owns its live tool list
// and schemas; `enabledTools` is the workspace's allowlist over it so an
// upstream tool addition can't silently widen Lor's surface. Sessions are
// created per respond() call (the datadogMcpTools pattern, generalized).
// See reference/automation-primitives.md §4.
export const mcpServerAuthModeEnum = pgEnum("mcp_server_auth_mode", [
  "static",
  "oauth",
])

export type McpServerAuthMode =
  (typeof mcpServerAuthModeEnum.enumValues)[number]

export const mcpServerOAuthStatusEnum = pgEnum("mcp_server_oauth_status", [
  "pending",
  "needs_tool_review",
  "connected",
  "reauthorization_required",
])

export type McpServerOAuthStatus =
  (typeof mcpServerOAuthStatusEnum.enumValues)[number]

export const mcpServer = pgTable(
  "mcp_server",
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
    // Lor's system prompt next to the server name.
    description: text("description").notNull().default(""),
    // https Streamable HTTP endpoint; same SSRF stance as custom tools,
    // checked at create AND connect time.
    url: text("url").notNull(),
    // `static` covers no-auth and user-supplied header/API-key auth. OAuth is
    // workspace-scoped: the authorizing member is audit provenance only.
    authMode: mcpServerAuthModeEnum("auth_mode").notNull().default("static"),
    oauthStatus: mcpServerOAuthStatusEnum("oauth_status"),
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
    // Allowlist of server tool names Lor may bind. Empty = none.
    enabledTools: text("enabled_tools").array().notNull().default([]),
  },
  (table) => [
    uniqueIndex("mcp_server_workspace_name_uidx").on(
      table.workspaceId,
      table.name
    ),
    index("mcp_server_oauth_authorized_by_idx").on(table.oauthAuthorizedBy),
    check(
      "mcp_server_auth_status_check",
      sql`(${table.authMode} = 'static' AND ${table.oauthStatus} IS NULL AND ${table.oauthCredentials} IS NULL AND ${table.oauthAuthorizedBy} IS NULL AND ${table.oauthAuthorizedAt} IS NULL) OR (${table.authMode} = 'oauth' AND ${table.oauthStatus} IS NOT NULL)`
    ),
    check(
      "mcp_server_oauth_connected_credentials_check",
      sql`${table.oauthStatus} NOT IN ('needs_tool_review', 'connected') OR (${table.oauthCredentials} IS NOT NULL AND ${table.oauthAuthorizedAt} IS NOT NULL)`
    ),
  ]
)

// Short-lived, single-use state for an interactive OAuth attempt. State and
// PKCE verifier are encrypted; stateHash is the only callback lookup key.
// At most one unconsumed attempt may exist for a server.
export const mcpServerOAuthAttempt = pgTable(
  "mcp_server_oauth_attempt",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
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
    uniqueIndex("mcp_server_oauth_attempt_state_hash_uidx").on(table.stateHash),
    uniqueIndex("mcp_server_oauth_attempt_live_server_uidx")
      .on(table.mcpServerId)
      .where(sql`${table.consumedAt} IS NULL`),
    index("mcp_server_oauth_attempt_workspace_idx").on(table.workspaceId),
    index("mcp_server_oauth_attempt_expires_idx").on(table.expiresAt),
    check(
      "mcp_server_oauth_attempt_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "mcp_server_oauth_attempt_consumed_check",
      sql`${table.consumedAt} IS NULL OR ${table.consumedAt} >= ${table.createdAt}`
    ),
  ]
)

// Per-profile server grants (used when the profile lacks the blanket
// `custom_tools` capability) — same shape and rationale as
// agent_profile_custom_tool: cascade cleanup, indexed reverse lookup.
export const agentProfileMcpServer = pgTable(
  "agent_profile_mcp_server",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => agentProfile.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.mcpServerId] }),
    index("agent_profile_mcp_server_lookup_idx").on(table.mcpServerId),
  ]
)

export const mcpServerRelations = relations(mcpServer, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [mcpServer.workspaceId],
    references: [workspace.id],
  }),
  oauthAuthorizer: one(user, {
    fields: [mcpServer.oauthAuthorizedBy],
    references: [user.id],
  }),
  oauthAttempts: many(mcpServerOAuthAttempt),
  profileGrants: many(agentProfileMcpServer),
}))

export const mcpServerOAuthAttemptRelations = relations(
  mcpServerOAuthAttempt,
  ({ one }) => ({
    mcpServer: one(mcpServer, {
      fields: [mcpServerOAuthAttempt.mcpServerId],
      references: [mcpServer.id],
    }),
    workspace: one(workspace, {
      fields: [mcpServerOAuthAttempt.workspaceId],
      references: [workspace.id],
    }),
    initiator: one(user, {
      fields: [mcpServerOAuthAttempt.initiatedBy],
      references: [user.id],
    }),
  })
)

export const agentProfileMcpServerRelations = relations(
  agentProfileMcpServer,
  ({ one }) => ({
    profile: one(agentProfile, {
      fields: [agentProfileMcpServer.profileId],
      references: [agentProfile.id],
    }),
    mcpServer: one(mcpServer, {
      fields: [agentProfileMcpServer.mcpServerId],
      references: [mcpServer.id],
    }),
  })
)

export type McpServer = typeof mcpServer.$inferSelect
export type NewMcpServer = typeof mcpServer.$inferInsert
export type McpServerOAuthAttempt = typeof mcpServerOAuthAttempt.$inferSelect
export type NewMcpServerOAuthAttempt = typeof mcpServerOAuthAttempt.$inferInsert
