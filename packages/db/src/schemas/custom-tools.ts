import { relations, sql } from "drizzle-orm"
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./users"
import { workspace } from "./workspaces"

// A workspace-registered tool Merlin can call: an HTTP request template with
// a JSON-Schema args contract. Channels opt in via the `custom_tools`
// capability (agent profiles). Archive-not-delete: rows are edited in place
// (no version history), archived rows keep their name free for reuse.
// See reference/automation-primitives.md §4.

export const customToolMethodEnum = pgEnum("custom_tool_method", [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
])

export const customToolStatusEnum = pgEnum("custom_tool_status", [
  "active",
  "archived",
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
    status: customToolStatusEnum("status").notNull().default("active"),
  },
  (table) => [
    // Names stay unique among ACTIVE tools; archiving frees the name.
    uniqueIndex("custom_tool_workspace_name_active_uidx")
      .on(table.workspaceId, table.name)
      .where(sql`status = 'active'`),
    index("custom_tool_workspace_idx").on(table.workspaceId),
  ]
)

export const customToolRelations = relations(customTool, ({ one }) => ({
  workspace: one(workspace, {
    fields: [customTool.workspaceId],
    references: [workspace.id],
  }),
}))

export type CustomTool = typeof customTool.$inferSelect
export type CustomToolMethod = (typeof customToolMethodEnum.enumValues)[number]
export type CustomToolStatus = (typeof customToolStatusEnum.enumValues)[number]
