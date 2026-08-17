import { relations } from "drizzle-orm"
import {
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

// A workspace-registered tool Merlin can call: an HTTP request template with
// a JSON-Schema args contract. Channels get tools through agent profiles:
// the blanket `custom_tools` capability grants all (current and future), or
// a profile grants specific tools via agent_profile_custom_tool rows. Rows
// are edited in place (no version history) and hard-deleted — FK cascades
// clean up profile grants atomically.
// See reference/automation-primitives.md §4.

export const customToolMethodEnum = pgEnum("custom_tool_method", [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
])

export const customTool = pgTable(
  "custom_tool",
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
    // Model-facing tool name (^[a-z][a-z0-9_]*$); also the dedupe key against
    // built-in tools at bind time.
    name: text("name").notNull(),
    // The model-facing contract: what the tool does and when to use it.
    description: text("description").notNull(),
    // JSON Schema (type: object) for the tool's arguments.
    argsSchema: jsonb("args_schema").$type<Record<string, unknown>>().notNull(),
    method: customToolMethodEnum("method").notNull(),
    // https URL with {{args.x}} / {{secrets.KEY}} placeholders.
    urlTemplate: text("url_template").notNull(),
    // Header name → value template.
    headers: jsonb("headers").$type<Record<string, string>>().notNull(),
    // Optional body template (POST/PUT/PATCH); placeholders substitute the
    // JSON encoding of the value. Null = send all args as a JSON object.
    bodyTemplate: text("body_template"),
    // Secret name → AES-256-GCM ciphertext. Values are write-only through the
    // API (responses expose names only) and decrypted at call time.
    secrets: jsonb("secrets").$type<Record<string, string>>().notNull(),
    // No read/write classification here on purpose: the future approvals flow
    // is permission-based (who may approve), configured when that ships — not
    // derivable from a mutation bit (automation-primitives.md §6.5).
  },
  (table) => [
    uniqueIndex("custom_tool_workspace_name_uidx").on(
      table.workspaceId,
      table.name
    ),
    index("custom_tool_workspace_idx").on(table.workspaceId),
  ]
)

// Per-profile custom tool grants (used when the profile lacks the blanket
// `custom_tools` capability). A real join table — not an id array — so
// deleting a tool cascades its grants away and "which profiles use this
// tool?" stays an indexed query. Room for per-grant metadata later (approvals).
export const agentProfileCustomTool = pgTable(
  "agent_profile_custom_tool",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => agentProfile.id, { onDelete: "cascade" }),
    customToolId: uuid("custom_tool_id")
      .notNull()
      .references(() => customTool.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.customToolId] }),
    index("agent_profile_custom_tool_tool_idx").on(table.customToolId),
  ]
)

export const customToolRelations = relations(customTool, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [customTool.workspaceId],
    references: [workspace.id],
  }),
  profileGrants: many(agentProfileCustomTool),
}))

export const agentProfileCustomToolRelations = relations(
  agentProfileCustomTool,
  ({ one }) => ({
    profile: one(agentProfile, {
      fields: [agentProfileCustomTool.profileId],
      references: [agentProfile.id],
    }),
    customTool: one(customTool, {
      fields: [agentProfileCustomTool.customToolId],
      references: [customTool.id],
    }),
  })
)

export type CustomTool = typeof customTool.$inferSelect
export type CustomToolMethod = (typeof customToolMethodEnum.enumValues)[number]
