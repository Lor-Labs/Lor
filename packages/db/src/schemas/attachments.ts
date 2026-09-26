import { sql } from "drizzle-orm"
import {
  boolean,
  halfvec,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { LOR_EMBED_DIMENSIONS } from "../constants"
import { channel } from "./channels"
import { message } from "./messages"
import { workspace } from "./workspaces"

// One searchable piece of a chat attachment: a whole image, or one page,
// slide, or part of a document. A rebuildable index derived from
// message.attachments + R2. DMs are never indexed (they will be E2E
// encrypted). See reference/attachment-search.md.
export const attachmentChunk = pgTable(
  "attachment_chunk",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    // 0 = the whole file; otherwise the 1-based PDF page, slide, or part.
    position: integer("position").notNull().default(0),
    text: text("text").notNull(),
    embedding: halfvec("embedding", { dimensions: LOR_EMBED_DIMENSIONS }),
    truncated: boolean("truncated").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("attachment_chunk_message_url_position_uidx").on(
      table.messageId,
      table.url,
      table.position
    ),
    index("attachment_chunk_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("halfvec_cosine_ops")
    ),
    // Expression index over filename + text; queries must use the identical
    // expression. translate() splits names like attio-logo.png into words.
    index("attachment_chunk_text_tsv_idx").using(
      "gin",
      sql`to_tsvector('english', translate(${table.filename}, '._-', '   ') || ' ' || ${table.text})`
    ),
  ]
)

export type AttachmentChunk = typeof attachmentChunk.$inferSelect
export type NewAttachmentChunk = typeof attachmentChunk.$inferInsert
