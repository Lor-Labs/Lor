import { relations, sql } from "drizzle-orm"
import {
  halfvec,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { LOR_EMBED_DIMENSIONS } from "../constants"
import {
  integrationConnection,
  integrationProviderEnum,
} from "./integration-connections"
import { workspace } from "./workspaces"

// An item ingested from a connected service (a GitHub PR or issue, a Linear
// issue, an Attio note or call recording): its real text, refetched whenever
// the service signals a change. Workspace-visible: connecting a service shares
// what it can see. Search runs over source_chunk.
// See reference/planned/context-engine-phase-2.md.

// archived = deleted at the service or out of the connection's reach. The row
// stays as a tombstone; its body and chunks are dropped.
export const sourceStatusEnum = pgEnum("source_status", ["active", "archived"])

export const source = pgTable(
  "source",
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
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnection.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    // Provider-specific unit, e.g. "pull_request" | "issue" | "note" |
    // "call_recording".
    kind: text("kind").notNull(),
    // Stable provider key for upsert, e.g. "owner/repo#123" (lowercased),
    // "LOR-123", "note#<id>".
    externalId: text("external_id").notNull(),
    url: text("url"),
    title: text("title").notNull(),
    // The item's author as the service names them (a GitHub login, a name).
    author: text("author"),
    // e.g. "open" | "merged" | "closed", or the Linear workflow state name.
    state: text("state"),
    // The item as text (title excluded): a metadata line, the description,
    // then its discussion.
    body: text("body").notNull().default(""),
    // Hash of title, state and body; chunks are rebuilt only when it changes.
    // Null on tombstones.
    contentHash: text("content_hash"),
    sourceCreatedAt: timestamp("source_created_at"),
    sourceUpdatedAt: timestamp("source_updated_at"),
    // The last successful fetch, changed or not; the verify sweep rechecks the
    // oldest first. Null only on rows from before ingestion stored real text.
    fetchedAt: timestamp("fetched_at"),
    status: sourceStatusEnum("status").notNull().default("active"),
  },
  (table) => [
    // Re-ingesting the same unit upserts in place.
    uniqueIndex("source_workspace_provider_external_uidx").on(
      table.workspaceId,
      table.provider,
      table.externalId
    ),
    index("source_connection_fetched_idx").on(
      table.connectionId,
      table.fetchedAt
    ),
  ]
)

// One searchable piece of a source's body. Every chunk starts with the item's
// title, so a title match finds any chunk.
export const sourceChunk = pgTable(
  "source_chunk",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    embedding: halfvec("embedding", { dimensions: LOR_EMBED_DIMENSIONS }),
  },
  (table) => [
    uniqueIndex("source_chunk_source_position_uidx").on(
      table.sourceId,
      table.position
    ),
    index("source_chunk_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("halfvec_cosine_ops")
    ),
    // Expression index; queries must use the identical expression.
    index("source_chunk_text_tsv_idx").using(
      "gin",
      sql`to_tsvector('english', ${table.text})`
    ),
    index("source_chunk_workspace_idx").on(table.workspaceId),
  ]
)

export const sourceRelations = relations(source, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [source.workspaceId],
    references: [workspace.id],
  }),
  connection: one(integrationConnection, {
    fields: [source.connectionId],
    references: [integrationConnection.id],
  }),
  chunks: many(sourceChunk),
}))

export const sourceChunkRelations = relations(sourceChunk, ({ one }) => ({
  source: one(source, {
    fields: [sourceChunk.sourceId],
    references: [source.id],
  }),
}))

export type Source = typeof source.$inferSelect
export type NewSource = typeof source.$inferInsert
export type SourceChunk = typeof sourceChunk.$inferSelect
