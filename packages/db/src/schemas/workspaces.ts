import { relations } from "drizzle-orm"
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod"
import { invitation } from "./invitations"
import { user } from "./users"
import { workspaceInvite } from "./workspace-invites"
import { workspaceMember } from "./workspace-members"
import { workspaceRole } from "./workspace-roles"

export const workspace = pgTable(
  "workspace",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    // Opaque server-generated URL key (workspaceKey() in @repo/utils), never
    // user-chosen. Immutable: MCP OAuth redirect URIs and bookmarks embed it.
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    description: text("description"),
    // Bare domain (normalizeDomain), e.g. "acme.com".
    website: text("website"),
    // Verified email domain whose users may join without an invite. Only an
    // admin on that domain can set it.
    joinDomain: text("join_domain"),
    setupCompletedAt: timestamp("setup_completed_at"),
    createdAt: timestamp("created_at").notNull(),
    ownerId: uuid("owner_id") // source of truth for workspace ownership — derive owner status by comparing user.id against workspace.ownerId, NOT from workspace_member.role
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }), // don't delete workspace if owner deletes account
    metadata: text("metadata"),
    // Idempotency claim for the one-time signup credit grant (set when the
    // workspace's first invite is accepted; reverted if the grant fails).
    promoGrantedAt: timestamp("promo_granted_at"),
  },
  (table) => [
    uniqueIndex("workspace_slug_uidx").on(table.slug),
    index("workspace_joinDomain_idx").on(table.joinDomain),
  ]
)

export const workspaceRelations = relations(workspace, ({ one, many }) => ({
  user: one(user, {
    fields: [workspace.ownerId],
    references: [user.id],
  }),
  workspaceMembers: many(workspaceMember),
  workspaceRoles: many(workspaceRole),
  invitations: many(invitation),
  workspaceInvites: many(workspaceInvite),
}))

// Zod schemas
export const selectWorkspaceSchema = createSelectSchema(workspace)

export const insertWorkspaceSchema = createInsertSchema(workspace, {
  name: (s) => s.min(1).max(100),
})

export const updateWorkspaceSchema = createUpdateSchema(workspace, {
  name: (s) => s.min(1).max(100),
})
