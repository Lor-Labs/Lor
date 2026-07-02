import { relations, sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { channel } from "./channels"
import { user } from "./users"

export const messageTypeEnum = pgEnum("message_type", [
  "default",
  "reply",
  "system_join",
  "system_leave",
  "system_pin",
  "channel_name_change",
])

// Lifecycle of a message row. Everything is "complete" except a Merlin
// placeholder, which lands as "pending" and flips to "complete"/"failed" when
// the worker finishes — so the thinking indicator survives a reload/late join.
export const messageStatusEnum = pgEnum("message_status", [
  "complete",
  "pending",
  "failed",
])

export const message = pgTable(
  "message",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    authorId: uuid("author_id") // all messages must have an author
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    content: text("content"),
    type: messageTypeEnum("type").notNull().default("default"),
    status: messageStatusEnum("status").notNull().default("complete"),

    // for replies — points to the message being replied to
    referencedMessageId: uuid("referenced_message_id").references(
      (): AnyPgColumn => message.id,
      { onDelete: "set null" }
    ),

    // thread root — when set, this message is a thread reply and does NOT
    // appear in the channel feed. NULL = channel message (may itself host a thread).
    threadRootId: uuid("thread_root_id").references(
      (): AnyPgColumn => message.id,
      { onDelete: "cascade" }
    ),

    // file attachments as JSON array
    // [{ url, filename, size, contentType, width?, height? }]
    attachments: jsonb("attachments").$type<Attachment[]>().default([]),

    // link/media embeds
    // [{ type, url, title?, description?, thumbnail? }]
    embeds: jsonb("embeds").$type<Embed[]>().default([]),

    // Merlin's tool-call trail for this answer — the tools it consulted to
    // produce the reply, kept as a durable, legible record. [{ toolCallId,
    // toolName, label }]
    merlinToolCalls: jsonb("merlin_tool_calls")
      .$type<MerlinToolCall[]>()
      .default([]),

    // Brain pages Merlin saved/updated while producing this answer (explicit
    // "remember this" + the autonomous write-back) — a durable record of what it
    // committed to memory, shown under the reply. Serialized as `remembered`.
    merlinMemories: jsonb("merlin_memories")
      .$type<MerlinMemory[]>()
      .default([]),

    // Summarized extended-thinking trace for a Merlin reply — streamed live and
    // kept so the collapsible "thought process" survives a reload.
    merlinReasoning: text("merlin_reasoning"),

    pinned: boolean("pinned").default(false).notNull(),

    editedAt: timestamp("edited_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("message_channelId_createdAt_idx").on(
      table.channelId,
      table.createdAt
    ),
    index("message_authorId_idx").on(table.authorId),
    index("message_referencedMessageId_idx").on(table.referencedMessageId),
    index("message_threadRootId_createdAt_idx").on(
      table.threadRootId,
      table.createdAt
    ),
    index("message_content_trgm_idx").using(
      "gin",
      sql`${table.content} gin_trgm_ops`
    ),
    // FTS backing Merlin's search tool. Expression index (no tsvector column),
    // so queries must match: to_tsvector('english', coalesce(content, '')).
    index("message_content_tsv_idx").using(
      "gin",
      sql`to_tsvector('english', coalesce(${table.content}, ''))`
    ),
  ]
)

export const messageRelations = relations(message, ({ one }) => ({
  channel: one(channel, {
    fields: [message.channelId],
    references: [channel.id],
  }),
  author: one(user, {
    fields: [message.authorId],
    references: [user.id],
  }),
  referencedMessage: one(message, {
    fields: [message.referencedMessageId],
    references: [message.id],
    relationName: "messageReply",
  }),
  threadRoot: one(message, {
    fields: [message.threadRootId],
    references: [message.id],
    relationName: "threadReplies",
  }),
}))

export const selectMessageSchema = createSelectSchema(message)
export const insertMessageSchema = createInsertSchema(message).omit({
  id: true,
  createdAt: true,
  editedAt: true,
})

export type MessageStatus = (typeof messageStatusEnum.enumValues)[number]

// Type definitions for the JSONB fields
export type Attachment = {
  url: string
  filename: string
  size: number
  contentType: string
  width?: number
  height?: number
}

export type Embed = {
  type: "link" | "image" | "video" | "rich"
  url: string
  title?: string
  description?: string
  thumbnail?: string
  siteName?: string
}

export type MerlinToolCall = {
  toolCallId: string
  toolName: string
  // Human status line, e.g. "Searching connected sources for …".
  label: string
  // Set on a nested sub-step (e.g. a code-investigation sandbox agent's own
  // tool calls) → the toolCallId of the parent tool. Top-level calls omit it.
  parentToolCallId?: string
  // Character offset into the message `content` where this call occurred, so the
  // UI can render text and tool groups in the order the model produced them.
  at?: number
  // Compact, bounded result for the expandable detail panel (filled on
  // completion; absent while the call is still in flight or for tools whose
  // label already says everything).
  detail?: {
    summary?: string
    items?: { title: string; url?: string }[]
  }
  status?: "ok" | "error"
}

// A brain page Merlin wrote during an answer.
export type MerlinMemory = {
  path: string
  action: "created" | "updated"
}
