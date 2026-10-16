import { relations, sql } from "drizzle-orm"
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { createSelectSchema } from "drizzle-zod"
import {
  DEFAULT_PROFILE_TOOL_ACCESS,
  type ProfileToolAccess,
} from "./profile-tool-access"
import { workspace } from "./workspaces"

// A named tool-access profile assigned to a channel or category. Resolution is
// channel profile → parent category's profile → the workspace default. All tool
// access lives in toolAccess.
export const agentProfile = pgTable(
  "agent_profile",
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
    name: text("name").notNull(),
    toolAccess: jsonb("tool_access")
      .$type<ProfileToolAccess>()
      .notNull()
      .default(DEFAULT_PROFILE_TOOL_ACCESS),
    // The workspace fallback (exactly one per workspace): used when a channel and
    // its category both lack an explicit profile.
    isDefault: boolean("is_default").notNull().default(false),
  },
  (table) => [
    index("agent_profile_workspaceId_idx").on(table.workspaceId),
    // At most one default profile per workspace.
    uniqueIndex("agent_profile_workspace_default_uidx")
      .on(table.workspaceId)
      .where(sql`${table.isDefault} = true`),
  ]
)

export const agentProfileRelations = relations(agentProfile, ({ one }) => ({
  workspace: one(workspace, {
    fields: [agentProfile.workspaceId],
    references: [workspace.id],
  }),
}))

export const selectAgentProfileSchema = createSelectSchema(agentProfile)

export type AgentProfile = typeof agentProfile.$inferSelect
export type NewAgentProfile = typeof agentProfile.$inferInsert
