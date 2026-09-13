import { relations } from "drizzle-orm"
import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./users"
import { workspace } from "./workspaces"

// "team" joins this once teams exist as a product concept (planned resolver:
// e.g. assign a gate to #eng).
export const approvalResolverKindEnum = pgEnum("approval_resolver_kind", [
  "any_member",
  "role",
  "user",
])

// Which agent tool targets require human approval and who may resolve them
// (LOR-81). Computed model: a row exists only where the workspace opted in —
// row existence = gate on, deleting the row turns the gate off. No seeding.
// Target key forms (see @repo/connectors approval-targets):
// capability:<lor_capability> | custom_tool:<id> | mcp_server:<id>
export const approvalPolicy = pgTable(
  "approval_policy",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    target: text("target").notNull(),
    resolverKind: approvalResolverKindEnum("resolver_kind")
      .notNull()
      .default("any_member"),
    // Set when resolverKind = "role" — static or custom role name.
    resolverRole: text("resolver_role"),
    // Set when resolverKind = "user". set-null on user delete so the gate
    // fails closed to owner-only instead of silently disappearing.
    resolverUserId: uuid("resolver_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("approvalPolicy_workspaceId_target_uidx").on(
      table.workspaceId,
      table.target
    ),
  ]
)

export const approvalPolicyRelations = relations(approvalPolicy, ({ one }) => ({
  workspace: one(workspace, {
    fields: [approvalPolicy.workspaceId],
    references: [workspace.id],
  }),
}))

export type ApprovalPolicy = typeof approvalPolicy.$inferSelect
export type NewApprovalPolicy = typeof approvalPolicy.$inferInsert
export type ApprovalResolverKind =
  (typeof approvalResolverKindEnum.enumValues)[number]
