import { relations, sql } from "drizzle-orm"
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { createSelectSchema } from "drizzle-zod"
import { workspace } from "./workspaces"

// What Merlin is allowed to *do* in a channel — gated tools/connectors, not the
// brain (the brain is shared institutional memory, never walled). Add a value
// as each gated ability lands; brain read/write + chat search are always-on
// core and deliberately NOT capabilities. See reference/merlin-architecture.md §8.1.
export const merlinCapabilityEnum = pgEnum("merlin_capability", [
  "github",
  "code",
  "linear",
  "linear_write",
  "datadog",
])

export type MerlinCapability = (typeof merlinCapabilityEnum.enumValues)[number]

// The full set — what a `grantsAll` profile (the permissive default) resolves to,
// now and as new capabilities are added.
export const ALL_MERLIN_CAPABILITIES: MerlinCapability[] = [
  ...merlinCapabilityEnum.enumValues,
]

// A named capability preset assigned to a channel or category. Resolution is
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
    // The workspace fallback (exactly one per workspace): used when a channel and
    // its category both lack an explicit profile.
    isDefault: boolean("is_default").notNull().default(false),
    // Grants every capability, including ones added later — the permissive
    // default ("everything connected, tune from there"). When false,
    // `capabilities` is the explicit allowlist.
    grantsAll: boolean("grants_all").notNull().default(false),
    capabilities: merlinCapabilityEnum("capabilities")
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
