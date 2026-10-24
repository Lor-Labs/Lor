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
  // A plan's card — rendered as the live plan card and acting as the
  // thread root of the plan's conversation. The plan row (see plans.ts) is
  // looked up by cardMessageId.
  "plan_card",
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
  // A voice session's anchor — the thread root of the session chat. The
  // session row (see voice.ts) is looked up by threadRootId.
  "voice_session",
  // Lor's summary of an ended call, posted in its chat. Renders the call's
  // current summary; the session row is looked up by summaryCardMessageId.
  "call_summary",
  // A Lor session's anchor: blank, never shown in chat, the thread root of
  // the session's messages. The row (see agent-sessions.ts) is looked up by
  // threadRootId.
  "agent_session",
  // A forwarded message (Discord-style): `forwarded` holds a snapshot of the
  // original, shown under the forwarder's note (content, may be empty);
  // referencedMessageId points at the original while it exists. Today: a
  // session message forwarded into its channel's chat (Lor never posts
  // there itself); later, chat forwarded between channels.
  "forward",
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
  // One fire of a loop, the first line of its turn in the loop's session.
  "loop_run",
  // The connector event that started an Act session. Content is the event
  // payload Lor reads; clients show the label.
  "trigger_run",
  // In a session: someone continued it in a new code session.
  "session_continued",
  // In a code session: someone committed its staged files.
  "session_committed",
  // In a code session: someone pushed its commits to GitHub.
  "session_pushed",
])

// Lifecycle of a message row. Everything is "complete" except a Lor
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
    // Set only when type = "forward": the original as it was when forwarded.
    forwarded: jsonb("forwarded").$type<ForwardedMessage>(),

    // thread root — when set, this message is a thread reply and does NOT
    // appear in the channel feed. NULL = channel message (may itself host a thread).
    threadRootId: uuid("thread_root_id").references(
      (): AnyPgColumn => message.id,
      { onDelete: "cascade" }
    ),

    // A person's message in a Lor session: whether it went to Lor, decided
    // at send time by the session routing rule. false = for the session's
    // subscribers only (shown as an aside). Null outside sessions and on
    // Lor's own messages.
    routedToLor: boolean("routed_to_lor"),

    // file attachments as JSON array
    // [{ url, filename, size, contentType, width?, height? }]
    attachments: jsonb("attachments").$type<Attachment[]>().default([]),

    // link/media embeds
    // [{ type, url, title?, description?, thumbnail? }]
    embeds: jsonb("embeds").$type<Embed[]>().default([]),

    // Lor's tool-call trail for this answer — the tools it consulted to
    // produce the reply, kept as a durable, legible record. [{ toolCallId,
    // toolName, label }]
    lorToolCalls: jsonb("lor_tool_calls").$type<LorToolCall[]>().default([]),

    // Brain pages Lor saved/updated while producing this answer (explicit
    // "remember this" + the autonomous write-back) — a durable record of what it
    // committed to memory, shown under the reply. Serialized as `remembered`.
    lorMemories: jsonb("lor_memories").$type<LorMemory[]>().default([]),

    // Aggregate reasoning retained for older clients/messages. New replies also
    // store ordered segments so reasoning can be interleaved with tool calls.
    lorReasoning: text("lor_reasoning"),
    lorReasoningSegments: jsonb("lor_reasoning_segments")
      .$type<LorReasoningSegment[]>()
      .default([]),

    // Display identity for webhook/connector messages (Discord-style). The row
    // is authored by the shared app bot user; these override what renders.
    overrideName: text("override_name"),
    overrideAvatarUrl: text("override_avatar_url"),

    // Connector notification messages are pointers — their canonical content
    // lives in `source`. Excluded from Lor's search so retrieval doesn't
    // surface mirrors of what the sources layer already returns.
    excludedFromMemory: boolean("excluded_from_memory")
      .default(false)
      .notNull(),

    pinned: boolean("pinned").default(false).notNull(),

    // Client-generated send nonce, persisted for idempotency: a resend after
    // an ack was lost matches the unique index below and returns the original
    // row instead of double-posting (and double-triggering Lor).
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
    // FTS backing Lor's search tool. Expression index (no tsvector column),
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

// A forwarded message's snapshot (message.forwarded). Self-contained so the
// target channel can read it even when its members can't open the source
// (channel-to-channel forwards), and after the source changes or is deleted.
export type ForwardedMessage = {
  messageId: string
  author: { id: string; name: string; image: string | null }
  content: string | null
  // Resolves stored mention tokens without access to the source.
  mentions: { id: string; name: string; image: string | null }[]
  createdAt: string
  // Where it was posted: a channel's chat, or a session in it.
  source: {
    channelId: string
    channelName: string | null
    sessionId: string | null
    sessionTitle: string | null
  }
}

export type TriggerRunPayload = {
  triggerId: string
  // Event source label, e.g. "GitHub · Pull request merged".
  label: string
}

export type SessionContinuedPayload = {
  // The new code session.
  sessionId: string
  repoFullName: string | null
}

export type SessionCommittedPayload = {
  sessionId: string
  sha: string
  subject: string
  // Null on a detached HEAD.
  branch: string | null
  fileCount: number
}

export type SessionPushedPayload = {
  sessionId: string
  repoFullName: string
  branch: string
  commitCount: number
  headSha: string
}

export type ChannelEventPayload =
  | ChannelCreatedPayload
  | ChannelRenamedPayload
  | MemberAddedPayload
  | MemberRemovedPayload
  | LoopEventPayload
  | TriggerRunPayload
  | SessionContinuedPayload
  | SessionCommittedPayload
  | SessionPushedPayload
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
  meeting?: {
    recordingId: string
    meetingId: string
    durationMinutes: number
    participants: string[]
    transcript: string
    transcriptTruncated: boolean
    summary?: string
    followUps: { label: string; prompt: string }[]
  }
}

export type LorToolCall = {
  toolCallId: string
  toolName: string
  // Human status line, e.g. "Searching connected sources for …".
  label: string
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
  // File change a sandbox write/edit made: line counts for the row label and
  // a bounded diff for the expandable view.
  diff?: {
    path: string
    additions: number
    deletions: number
    patch?: string
    truncated?: boolean
  }
  // Artifact deliverables this call produced (share_file) — presented
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
export type LorToolCallUpdate = Partial<LorToolCall> & {
  toolCallId: string
}

export type LorReasoningSegment = {
  text: string
  // Character offset into message content when this reasoning was produced.
  at: number
  // Relative order among reasoning/tool events at the same content offset.
  order: number
}

// A brain page Lor wrote during an answer. nodeId references the brain
// node durably (paths go stale on move/rename); optional — rows written
// before it existed carry only the path.
export type LorMemory = {
  path: string
  action: "created" | "updated"
  nodeId?: string
}
