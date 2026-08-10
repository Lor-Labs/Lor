import { relations, sql } from "drizzle-orm"
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { channel } from "./channels"
import { task } from "./tasks"
import { user } from "./users"
import { workspace } from "./workspaces"

// A file deliverable. Identity (this table) is deliberately separate from
// content (`artifact_version`, full snapshots): a future collaborative-editing
// session changes how the current content is produced, while identity,
// permissions, history, and attribution stay here. All writes — sandbox
// harvest, human edits, future CRDT session flushes — go through
// @repo/merlin's writeArtifactVersion, never straight to these tables.
export const artifactAuthorTypeEnum = pgEnum("artifact_author_type", [
  "agent",
  "user",
])

export const artifact = pgTable(
  "artifact",
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
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    // Null for artifacts produced by a plain (non-task) answer.
    taskId: uuid("task_id").references(() => task.id, {
      onDelete: "set null",
    }),
    // Logical filename within the task workspace, e.g. "report.md".
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    // 0 = created but no committed version yet; bumped atomically by
    // writeArtifactVersion.
    currentVersion: integer("current_version").notNull().default(0),
    createdById: uuid("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    // Within a task, a path names one artifact — repeated writes version it.
    // Also serves plain taskId lookups (all of them filter non-null), so no
    // standalone taskId index.
    uniqueIndex("artifact_task_path_uidx")
      .on(table.taskId, table.path)
      .where(sql`task_id is not null`),
    index("artifact_channelId_idx").on(table.channelId),
    index("artifact_workspaceId_createdAt_idx").on(
      table.workspaceId,
      table.createdAt
    ),
  ]
)

// Append-only full snapshots. `baseVersion` records what the author derived
// from, so a future session layer can detect divergent edits instead of
// silently overwriting.
export const artifactVersion = pgTable(
  "artifact_version",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    baseVersion: integer("base_version"),
    blobKey: text("blob_key").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    authorType: artifactAuthorTypeEnum("author_type").notNull(),
    authorId: uuid("author_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("artifact_version_artifact_version_uidx").on(
      table.artifactId,
      table.version
    ),
  ]
)

export const artifactRelations = relations(artifact, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [artifact.workspaceId],
    references: [workspace.id],
  }),
  channel: one(channel, {
    fields: [artifact.channelId],
    references: [channel.id],
  }),
  task: one(task, {
    fields: [artifact.taskId],
    references: [task.id],
  }),
  versions: many(artifactVersion),
}))

export const artifactVersionRelations = relations(
  artifactVersion,
  ({ one }) => ({
    artifact: one(artifact, {
      fields: [artifactVersion.artifactId],
      references: [artifact.id],
    }),
  })
)

export type Artifact = typeof artifact.$inferSelect
export type NewArtifact = typeof artifact.$inferInsert
export type ArtifactVersion = typeof artifactVersion.$inferSelect
export type NewArtifactVersion = typeof artifactVersion.$inferInsert
export type ArtifactAuthorType =
  (typeof artifactAuthorTypeEnum.enumValues)[number]
