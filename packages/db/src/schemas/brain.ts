import { relations } from "drizzle-orm"
import {
  type AnyPgColumn,
  halfvec,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { LOR_EMBED_DIMENSIONS } from "../constants"
import { workspace } from "./workspaces"

// Lor's brain: a filesystem tree (parent_id) and a typed graph (brain_edge)
// over the same page nodes. Tree = where a page lives; edges = what it relates
// to. See reference/lor-mvp-spec.md §5.

export const brainNodeKindEnum = pgEnum("brain_node_kind", ["folder", "page"])
export const brainNodeStatusEnum = pgEnum("brain_node_status", [
  "active",
  "archived",
])

export const brainNode = pgTable(
  "brain_node",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // Memory scope: null = workspace-wide; else the access container channel
    // (project category or private channel) whose runs may retrieve this node.
    // Archive synthesis writes workspace-scoped pages to promote durable
    // conclusions out of the boundary. FK omitted (schema import cycle).
    scopeChannelId: uuid("scope_channel_id"),
    kind: brainNodeKindEnum("kind").notNull(),
    // null parent = top-level node
    parentId: uuid("parent_id").references((): AnyPgColumn => brainNode.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    // page-only payload (null on folders)
    body: text("body"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    // Qwen3 Embedding 4B. halfvec keeps the 2560 native dimensions indexable:
    // pgvector HNSW caps float32 vector indexes at 2000 dimensions.
    embedding: halfvec("embedding", { dimensions: LOR_EMBED_DIMENSIONS }),
    // decay = archive, never delete; version bumps on body update
    status: brainNodeStatusEnum("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // unique siblings; NULLS NOT DISTINCT so top-level names can't collide.
    // backing index also serves ls() on (workspace_id, parent_id).
    unique("brain_node_parent_name_uq")
      .on(table.workspaceId, table.parentId, table.name)
      .nullsNotDistinct(),
    index("brain_node_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("halfvec_cosine_ops")
    ),
    index("brain_node_workspace_scope_idx").on(
      table.workspaceId,
      table.scopeChannelId
    ),
  ]
)

// A page's previous bodies: every body change saves the old one here in the
// same transaction, so an edit or rewrite can always be recovered.
// reference/planned/session-memory.md Step 3.
export const brainNodeVersion = pgTable(
  "brain_node_version",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => brainNode.id, { onDelete: "cascade" }),
    // The version this body had before the change replaced it.
    version: integer("version").notNull(),
    body: text("body").notNull(),
    // The agent run that made the change; null outside a run (write-back,
    // archive synthesis). FK omitted (schema import cycle).
    runId: uuid("run_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("brain_node_version_node_version_uidx").on(
      table.nodeId,
      table.version
    ),
  ]
)

// Controlled vocabulary for typed edges between pages — add values deliberately.
export const BRAIN_EDGE_TYPES = [
  "relates_to",
  "supersedes",
  "caused_by",
  "depends_on",
  "part_of",
  "owned_by",
] as const
export const brainEdgeTypeEnum = pgEnum("brain_edge_type", BRAIN_EDGE_TYPES)

// Typed edges between pages.
export const brainEdge = pgTable(
  "brain_edge",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => brainNode.id, { onDelete: "cascade" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => brainNode.id, { onDelete: "cascade" }),
    type: brainEdgeTypeEnum("type").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("brain_edge_from_to_type_uidx").on(
      table.fromNodeId,
      table.toNodeId,
      table.type
    ),
    index("brain_edge_workspace_from_idx").on(
      table.workspaceId,
      table.fromNodeId
    ),
    index("brain_edge_workspace_to_idx").on(table.workspaceId, table.toNodeId),
  ]
)

export const brainNodeRelations = relations(brainNode, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [brainNode.workspaceId],
    references: [workspace.id],
  }),
  parent: one(brainNode, {
    fields: [brainNode.parentId],
    references: [brainNode.id],
    relationName: "brainNodeParent",
  }),
  children: many(brainNode, { relationName: "brainNodeParent" }),
  outgoingEdges: many(brainEdge, { relationName: "brainEdgeFrom" }),
  incomingEdges: many(brainEdge, { relationName: "brainEdgeTo" }),
}))

export const brainEdgeRelations = relations(brainEdge, ({ one }) => ({
  workspace: one(workspace, {
    fields: [brainEdge.workspaceId],
    references: [workspace.id],
  }),
  fromNode: one(brainNode, {
    fields: [brainEdge.fromNodeId],
    references: [brainNode.id],
    relationName: "brainEdgeFrom",
  }),
  toNode: one(brainNode, {
    fields: [brainEdge.toNodeId],
    references: [brainNode.id],
    relationName: "brainEdgeTo",
  }),
}))

export type BrainNode = typeof brainNode.$inferSelect
export type NewBrainNode = typeof brainNode.$inferInsert
export type BrainEdge = typeof brainEdge.$inferSelect
export type NewBrainEdge = typeof brainEdge.$inferInsert
