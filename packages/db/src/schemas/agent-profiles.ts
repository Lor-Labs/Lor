import { relations, sql } from "drizzle-orm"
import {
  boolean,
  index,
  jsonb,
  pgEnum,
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

// What Lor is allowed to *do* in a channel — gated tools/connectors, not the
// brain (the brain is shared institutional memory, never walled). Add a value
// as each gated ability lands; brain read/write + chat search are always-on
// core and deliberately NOT capabilities. See reference/archive/lor-agent-architecture.md §8.1.
export const lorCapabilityEnum = pgEnum("lor_capability", [
  "github",
  "code_intelligence",
  // Write side of code intelligence: propose changes as draft pull requests
  // (and, later, run/test code). Draft-only — Lor never merges.
  "code_actions",
  "linear",
  "linear_write",
  "datadog",
  "attio",
  "attio_write",
  "notion",
  "notion_write",
  "cloudwatch",
  "betterstack",
  "betterstack_write",
  "web",
  // Sandbox workbench sessions that produce file deliverables (artifacts).
  "artifacts",
  // The workspace's user-defined custom tools (custom_tool rows).
  "custom_tools",
])

export type LorCapability = (typeof lorCapabilityEnum.enumValues)[number]

// The full set — what a `grantsAll` profile (the permissive default) resolves to,
// now and as new capabilities are added.
export const ALL_LOR_CAPABILITIES: LorCapability[] = [
  ...lorCapabilityEnum.enumValues,
]

// A named tool-access profile assigned to a channel or category. Resolution is
// channel profile → parent category's profile → the workspace default.
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
    // Standalone abilities and HTTP tools still use these internal grants.
    // Connector and MCP access always comes from toolAccess, even when true.
    grantsAll: boolean("grants_all").notNull().default(false),
    capabilities: lorCapabilityEnum("capabilities")
      .array()
      .notNull()
      .default([]),
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
