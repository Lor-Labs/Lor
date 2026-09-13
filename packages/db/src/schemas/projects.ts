import { relations } from "drizzle-orm"
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { brainNode } from "./brain"
import { channel } from "./channels"
import type { MerlinMemory } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

// A project is LIFECYCLE over a category channel — never access. Access lives
// on the category via channel.audience + channel_member, so authorization
// code never asks "is this a project?".
export const projectStatusEnum = pgEnum("project_status", [
  "active",
  // Archive requested: channels are locked while synthesis runs.
  "archiving",
  "archived",
])

export const project = pgTable(
  "project",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // The category channel that contains the project's channels and carries
    // its audience/membership.
    categoryChannelId: uuid("category_channel_id")
      .notNull()
      .unique()
      .references(() => channel.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    // Linear-aligned project description; feeds Lor runs and archive
    // synthesis. Optional — Lor infers from channel content if unset.
    // (Project NAME lives on the category channel.)
    description: text("description"),
    targetDate: timestamp("target_date"),
    status: projectStatusEnum("status").notNull().default("active"),
    archivedAt: timestamp("archived_at"),
    // Archive synthesis outputs, set when the worker finishes: the closing
    // summary and the brain pages it saved — the archived-project overview
    // renders both. (No channel message: the overview is the surface.)
    summary: text("summary"),
    archiveMemories: jsonb("archive_memories")
      .$type<MerlinMemory[]>()
      .default([]),
    // Brain folder all project-scoped memory (write-backs + the archive
    // synthesis) lives under. Created lazily on first memory write.
    brainFolderId: uuid("brain_folder_id").references(() => brainNode.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("project_workspaceId_status_idx").on(table.workspaceId, table.status),
  ]
)

export const projectRelations = relations(project, ({ one }) => ({
  workspace: one(workspace, {
    fields: [project.workspaceId],
    references: [workspace.id],
  }),
  categoryChannel: one(channel, {
    fields: [project.categoryChannelId],
    references: [channel.id],
  }),
  creator: one(user, {
    fields: [project.creatorId],
    references: [user.id],
  }),
  brainFolder: one(brainNode, {
    fields: [project.brainFolderId],
    references: [brainNode.id],
  }),
}))

export const selectProjectSchema = createSelectSchema(project)

export const insertProjectSchema = createInsertSchema(project, {
  description: (s) => s.max(2000),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  archivedAt: true,
  summary: true,
  archiveMemories: true,
  brainFolderId: true,
})
