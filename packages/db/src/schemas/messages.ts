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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { channel } from "./channels"
import { user } from "./users"

export const messageTypeEnum = pgEnum("message_type", [
  "default",
  "reply",
  // Channel event — an inline system row in the feed ("X created this
  // channel", "Alice was added"). The specific kind lives in eventType,
  // structured copy data in eventPayload, and content always carries the
  // plain-text rendering as the search/forward-compat fallback.
  "event",
  // A task's card — rendered as the live task card and acting as the
  // thread root of the task's conversation. The task row (see tasks.ts) is
  // looked up by cardMessageId.
  "task_card",
  // A loop's card — the scheduled-run automation's live status card. The
  // loop row (see loops.ts) is looked up by cardMessageId.
  "loop_card",
  // A workspace change proposal's card (see change-proposals.ts) — the
  // reviewable change set, looked up by cardMessageId.
  "proposal_card",
  // Posted each time a loop fires — renders as the compact loop chip inline
  // in the feed, marking the run. referencedMessageId points at the loop's
  // card message so clients resolve the loop row through cardMessageId
  // (falls back to plain content once the loop/card is gone).
  "loop_fire",
])

// Kinds of channel events (message.type = "event"). Adding a kind means a new
// enum value here + a payload shape + emitter + client copy.
export const channelEventTypeEnum = pgEnum("channel_event_type", [
  "channel_created",
  "channel_renamed",
  "member_added",
  "member_removed",
  "member_left",
  "loop_created",
  "loop_paused",
  "loop_completed",
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

    // Set only when type = "event". authorId is the actor; secondary parties
    // and copy data (old/new name, added user ids, loop name) live in the
    // payload, discriminated by eventType.
    eventType: channelEventTypeEnum("event_type"),
    eventPayload: jsonb("event_payload").$type<ChannelEventPayload>(),

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

    // Aggregate reasoning retained for older clients/messages. New replies also
    // store ordered segments so reasoning can be interleaved with tool calls.
    merlinReasoning: text("merlin_reasoning"),
    merlinReasoningSegments: jsonb("merlin_reasoning_segments")
      .$type<MerlinReasoningSegment[]>()
      .default([]),

    // Display identity for webhook/connector messages (Discord-style). The row
    // is authored by the shared app bot user; these override what renders.
    overrideName: text("override_name"),
    overrideAvatarUrl: text("override_avatar_url"),

    // Connector notification messages are pointers — their canonical content
    // lives in `source`. Excluded from Merlin's search so retrieval doesn't
    // surface mirrors of what the sources layer already returns.
    excludedFromMemory: boolean("excluded_from_memory")
      .default(false)
      .notNull(),

    pinned: boolean("pinned").default(false).notNull(),

    // Client-generated send nonce, persisted for idempotency: a resend after
    // an ack was lost matches the unique index below and returns the original
    // row instead of double-posting (and double-triggering Merlin).
    clientKey: text("client_key"),

    editedAt: timestamp("edited_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("message_channelId_createdAt_idx").on(
      table.channelId,
      table.createdAt
    ),
    uniqueIndex("message_author_channel_clientKey_uidx")
      .on(table.authorId, table.channelId, table.clientKey)
      .where(sql`client_key is not null`),
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
    // Supports exact attachment-object containment used by view_image.
    index("message_attachments_gin_idx").using("gin", table.attachments),
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
export type ChannelEventType = (typeof channelEventTypeEnum.enumValues)[number]

// Structured data for channel events, keyed by message.eventType. Names that
// must survive referent deletion (loop name, origin channel) are snapshotted;
// user names are not — clients resolve ids like mentions, and the message
// content carries the plain-text fallback.
export type ChannelCreatedPayload = {
  // Set when the channel came from an approved change proposal.
  via?: "proposal"
  originChannelId?: string
  originChannelName?: string
}

export type ChannelRenamedPayload = {
  from: string
  to: string
}

export type MemberAddedPayload = {
  // Users added; the adder is the message author.
  userIds: string[]
}

export type MemberRemovedPayload = {
  // User removed; the remover is the message author. member_left carries no
  // payload — the author is the leaver.
  userId: string
}

export type LoopEventPayload = {
  loopId: string
  loopName: string
  // loop_paused only
  reason?: "failures" | "out_of_credits"
  via?: "proposal"
}

export type ChannelEventPayload =
  | ChannelCreatedPayload
  | ChannelRenamedPayload
  | MemberAddedPayload
  | MemberRemovedPayload
  | LoopEventPayload
  | null

// Type definitions for the JSONB fields
export type Attachment = {
  url: string
  filename: string
  size: number
  contentType: string
  width?: number
  height?: number
}

export type EmbedField = {
  name: string
  value: string
  inline?: boolean
}

export type Embed = {
  type: "link" | "image" | "video" | "rich"
  // Optional for "rich" (webhook cards can be link-less); always set for
  // link/media unfurls.
  url?: string
  title?: string
  description?: string
  // First-party connector activity label, e.g. "Pull request opened".
  eventLabel?: string
  thumbnail?: string
  siteName?: string
  // Rich (webhook-card) extras — Discord embeds / Slack attachments map here.
  author?: { name: string; url?: string; iconUrl?: string }
  fields?: EmbedField[]
  image?: string
  footer?: string
  timestamp?: string
  // Normalized #rrggbb accent (Discord int / Slack hex-or-alias, sender-chosen).
  color?: string
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
  // Relative order among reasoning/tool events at the same content offset.
  order?: number
  // Compact, bounded result for the expandable detail panel (filled on
  // completion; absent while the call is still in flight or for tools whose
  // label already says everything).
  detail?: {
    summary?: string
    // favicon: site icon url for web results — rendered on the item's badge.
    items?: { title: string; url?: string; favicon?: string }[]
  }
  // File change a nested sandbox sub-step made (write/edit): line counts for
  // the row label and a bounded unified diff for the expandable view.
  diff?: {
    path: string
    additions: number
    deletions: number
    patch?: string
    truncated?: boolean
  }
  // Artifact deliverables this call produced (create_artifacts) — presented
  // as file cards at the end of the message, opening the artifact viewer.
  files?: {
    artifactId: string
    path: string
    contentType: string
    size: number
    url: string
  }[]
  status?: "ok" | "error"
}

// Streamed tool-trail frame: a start/result frame carries the full row, a
// mid-flight update (sandbox summary text, diffs) may be partial — merged
// onto the existing row by toolCallId.
export type MerlinToolCallUpdate = Partial<MerlinToolCall> & {
  toolCallId: string
}

export type MerlinReasoningSegment = {
  text: string
  // Character offset into message content when this reasoning was produced.
  at: number
  // Relative order among reasoning/tool events at the same content offset.
  order: number
}

// A brain page Merlin wrote during an answer. nodeId references the brain
// node durably (paths go stale on move/rename); optional — rows written
// before it existed carry only the path.
export type MerlinMemory = {
  path: string
  action: "created" | "updated"
  nodeId?: string
}
