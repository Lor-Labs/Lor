import { relations, sql } from "drizzle-orm"
import {
  foreignKey,
  halfvec,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { LOR_EMBED_DIMENSIONS } from "../constants"
import { agentRun } from "./agent-runs"
import { channel } from "./channels"
import { message } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

// What an ended call came to, written by Lor once and correctable by people.
// `atMs` points into the transcript, where the item was said.
export type VoiceSessionSummaryItem = { text: string; atMs: number | null }
export type VoiceSessionSummary = {
  summary: string
  decisions: VoiceSessionSummaryItem[]
  openQuestions: VoiceSessionSummaryItem[]
  followUps: VoiceSessionSummaryItem[]
}

// A voice session: one bounded conversation in a persistent voice channel,
// live while endedAt is null. Its root message anchors the session chat
// thread, and its id is the LiveKit room name.
export const voiceSession = pgTable(
  "voice_session",
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
    threadRootId: uuid("thread_root_id").references(() => message.id, {
      onDelete: "set null",
    }),
    createdById: uuid("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    // Set while nobody is connected. The session ends VOICE_SESSION_GRACE_MS
    // later unless someone rejoins; endedAt then takes this value.
    emptySince: timestamp("empty_since"),
    endedAt: timestamp("ended_at"),
    // Transcriber lease. The holding job renews seenAt while people are in
    // the call and clears jobId when the room empties; a stale lease means
    // the transcriber died, and the next one records the missing stretch.
    transcriberJobId: text("transcriber_job_id"),
    transcriberSeenAt: timestamp("transcriber_seen_at"),
    // Null for calls too short to summarize.
    summary: jsonb("summary").$type<VoiceSessionSummary>(),
    // Set once the ended call is summarized and its passages indexed.
    memoryProcessedAt: timestamp("memory_processed_at"),
  },
  (table) => [
    uniqueIndex("voice_session_channelId_live_uidx")
      .on(table.channelId)
      .where(sql`ended_at is null`),
    uniqueIndex("voice_session_threadRootId_uidx")
      .on(table.threadRootId)
      .where(sql`thread_root_id is not null`),
    index("voice_session_channelId_startedAt_idx").on(
      table.channelId,
      table.startedAt
    ),
  ]
)

// One row per person per session. The row id is the LiveKit participant
// identity, reused across reconnects and "Transfer here".
export const voiceSessionParticipant = pgTable(
  "voice_session_participant",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => voiceSession.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    firstJoinedAt: timestamp("first_joined_at").defaultNow().notNull(),
    // Null while disconnected.
    connectedAt: timestamp("connected_at"),
    lastLeftAt: timestamp("last_left_at"),
  },
  (table) => [
    uniqueIndex("voice_session_participant_sessionId_userId_uidx").on(
      table.sessionId,
      table.userId
    ),
    index("voice_session_participant_userId_connectedAt_idx").on(
      table.userId,
      table.connectedAt
    ),
  ]
)

// One final transcript segment from one person's microphone. Offsets are
// milliseconds on the session timeline (from voice_session.started_at).
export const voiceTranscriptSegment = pgTable(
  "voice_transcript_segment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => voiceSession.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").notNull(),
    // LiveKit track SID of the microphone.
    trackId: text("track_id").notNull(),
    // Assigned by the transcriber; stable across revisions of one segment.
    segmentId: text("segment_id").notNull(),
    revision: integer("revision").default(0).notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    text: text("text").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
  },
  (table) => [
    // Explicit name: the auto-generated one exceeds Postgres's 63-byte limit.
    foreignKey({
      columns: [table.participantId],
      foreignColumns: [voiceSessionParticipant.id],
      name: "voice_transcript_segment_participant_fk",
    }).onDelete("cascade"),
    uniqueIndex("voice_transcript_segment_sessionId_segmentId_uidx").on(
      table.sessionId,
      table.segmentId
    ),
    index("voice_transcript_segment_sessionId_startMs_idx").on(
      table.sessionId,
      table.startMs
    ),
  ]
)

export const voiceCaptureGapReasonEnum = pgEnum("voice_capture_gap_reason", [
  // A microphone's speech-to-text stream failed or closed early.
  "provider_error",
  // The transcriber lost the room and rejoined.
  "transcriber_restart",
  // The session ran without a transcriber in the room.
  "no_transcriber",
])

// A stretch of the session the transcript doesn't cover. A null participant
// means nobody was transcribed.
export const voiceCaptureGap = pgTable(
  "voice_capture_gap",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => voiceSession.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id"),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    reason: voiceCaptureGapReasonEnum("reason").notNull(),
  },
  (table) => [
    // Explicit name: the auto-generated one exceeds Postgres's 63-byte limit.
    foreignKey({
      columns: [table.participantId],
      foreignColumns: [voiceSessionParticipant.id],
      name: "voice_capture_gap_participant_fk",
    }).onDelete("cascade"),
    index("voice_capture_gap_sessionId_startMs_idx").on(
      table.sessionId,
      table.startMs
    ),
  ]
)

// One searchable piece of an ended call: a stretch of back-and-forth from its
// transcript, or its summary. `context` says where it sits (call, channel,
// date, speakers, and what was going on) and is indexed with the text
// (contextual retrieval). A rebuildable index; live calls are never indexed.
export const voicePassage = pgTable(
  "voice_passage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => voiceSession.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"transcript" | "summary">().notNull(),
    // Span on the session timeline; the summary spans the whole call.
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    context: text("context").notNull(),
    text: text("text").notNull(),
    embedding: halfvec("embedding", { dimensions: LOR_EMBED_DIMENSIONS }),
  },
  (table) => [
    uniqueIndex("voice_passage_session_kind_start_uidx").on(
      table.sessionId,
      table.kind,
      table.startMs
    ),
    index("voice_passage_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("halfvec_cosine_ops")
    ),
    // Expression index; queries must use the identical expression.
    index("voice_passage_text_tsv_idx").using(
      "gin",
      sql`to_tsvector('english', ${table.context} || ' ' || ${table.text})`
    ),
  ]
)

export const voiceRequestStatusEnum = pgEnum("voice_request_status", [
  // The name gate matched; waiting for the speaker to finish and for Jev.
  "listening",
  // Not a request to Lor, or the address check failed closed.
  "rejected",
  // Accepted; waiting for its run.
  "queued",
  "working",
  // The run paused on an approval gate that someone in the call can resolve.
  "awaiting_approval",
  "done",
  "failed",
  "cancelled",
])

// The approval a paused request waits on, shown over Lor's window. Approvers
// are the people connected to the call who can resolve it, kept current while
// it waits.
export type VoiceRequestApproval = {
  approvalId: string
  label: string
  toolName: string
  approvers: { userId: string; name: string }[]
}

// What Lor shows in its window, composed by the run. Generic blocks carry
// their own data, so any tool's results fit; connector cards come later.
export type VoiceBlock =
  | { type: "answer"; markdown: string }
  | { type: "question"; prompt: string; choices: string[] }
  | {
      type: "list"
      title: string | null
      items: { title: string; detail: string | null; url: string | null }[]
    }
  | {
      type: "table"
      title: string | null
      columns: string[]
      rows: string[][]
    }
  | {
      type: "details"
      title: string | null
      fields: { label: string; value: string }[]
    }
  // Entity blocks name records in a built-in connector; the window fills
  // them with live data, so nothing stored here goes stale.
  | {
      type: "linear_issues"
      title: string | null
      // Identifiers, e.g. "ENG-412".
      issues: string[]
    }
  | {
      type: "github_pull_requests"
      title: string | null
      // "owner/repo#142".
      pullRequests: string[]
    }

export type VoiceRequestResult = { blocks: VoiceBlock[] }

// One answer from Jev, the address check. Kept on the request for tuning.
export type VoiceRequestCheck = {
  model: string
  latencyMs: number
} & (
  | {
      addressed: number
      kind: "request" | "mention" | "continuation"
      kindConfidence: number
      complete: number
    }
  | { error: string }
)

// Something said to Lor in a call: who said it, what was heard, and how
// address detection decided. Rejected rows stay, so false triggers can be
// tuned.
export const voiceRequest = pgTable(
  "voice_request",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => voiceSession.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    heardText: text("heard_text").notNull(),
    // Span of the heard text on the session timeline.
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    // How it was asked: the gate matched "Lor" itself or a word it's
    // misheard as, or someone clicked a choice Lor offered.
    gate: text("gate").$type<"name" | "homophone" | "choice">().notNull(),
    status: voiceRequestStatusEnum("status").default("listening").notNull(),
    checks: jsonb("checks").$type<VoiceRequestCheck[]>().notNull().default([]),
    result: jsonb("result").$type<VoiceRequestResult>(),
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    cancelledById: uuid("cancelled_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    finishedAt: timestamp("finished_at"),
    // Someone cleared the finished result from Lor's window, for everyone.
    dismissedAt: timestamp("dismissed_at"),
    // Someone brought this result back into Lor's window ("Show on stage",
    // step-back).
    stagedAt: timestamp("staged_at"),
    approval: jsonb("approval").$type<VoiceRequestApproval>(),
  },
  (table) => [
    // Explicit name: the auto-generated one exceeds Postgres's 63-byte limit.
    foreignKey({
      columns: [table.participantId],
      foreignColumns: [voiceSessionParticipant.id],
      name: "voice_request_participant_fk",
    }).onDelete("cascade"),
    index("voice_request_sessionId_createdAt_idx").on(
      table.sessionId,
      table.createdAt
    ),
  ]
)

export const voiceRequestRelations = relations(voiceRequest, ({ one }) => ({
  session: one(voiceSession, {
    fields: [voiceRequest.sessionId],
    references: [voiceSession.id],
  }),
  participant: one(voiceSessionParticipant, {
    fields: [voiceRequest.participantId],
    references: [voiceSessionParticipant.id],
  }),
  run: one(agentRun, {
    fields: [voiceRequest.runId],
    references: [agentRun.id],
  }),
}))

export const voiceSessionRelations = relations(
  voiceSession,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [voiceSession.workspaceId],
      references: [workspace.id],
    }),
    channel: one(channel, {
      fields: [voiceSession.channelId],
      references: [channel.id],
    }),
    threadRoot: one(message, {
      fields: [voiceSession.threadRootId],
      references: [message.id],
    }),
    participants: many(voiceSessionParticipant),
    transcriptSegments: many(voiceTranscriptSegment),
    captureGaps: many(voiceCaptureGap),
    requests: many(voiceRequest),
  })
)

export const voiceTranscriptSegmentRelations = relations(
  voiceTranscriptSegment,
  ({ one }) => ({
    session: one(voiceSession, {
      fields: [voiceTranscriptSegment.sessionId],
      references: [voiceSession.id],
    }),
    participant: one(voiceSessionParticipant, {
      fields: [voiceTranscriptSegment.participantId],
      references: [voiceSessionParticipant.id],
    }),
  })
)

export const voiceCaptureGapRelations = relations(
  voiceCaptureGap,
  ({ one }) => ({
    session: one(voiceSession, {
      fields: [voiceCaptureGap.sessionId],
      references: [voiceSession.id],
    }),
    participant: one(voiceSessionParticipant, {
      fields: [voiceCaptureGap.participantId],
      references: [voiceSessionParticipant.id],
    }),
  })
)

export const voiceSessionParticipantRelations = relations(
  voiceSessionParticipant,
  ({ one }) => ({
    session: one(voiceSession, {
      fields: [voiceSessionParticipant.sessionId],
      references: [voiceSession.id],
    }),
    user: one(user, {
      fields: [voiceSessionParticipant.userId],
      references: [user.id],
    }),
  })
)

export type VoiceSession = typeof voiceSession.$inferSelect
export type NewVoiceSession = typeof voiceSession.$inferInsert
export type VoiceSessionParticipant =
  typeof voiceSessionParticipant.$inferSelect
export type NewVoiceSessionParticipant =
  typeof voiceSessionParticipant.$inferInsert
export type VoiceTranscriptSegment = typeof voiceTranscriptSegment.$inferSelect
export type NewVoiceTranscriptSegment =
  typeof voiceTranscriptSegment.$inferInsert
export type VoiceCaptureGap = typeof voiceCaptureGap.$inferSelect
export type NewVoiceCaptureGap = typeof voiceCaptureGap.$inferInsert
export type VoicePassage = typeof voicePassage.$inferSelect
export type NewVoicePassage = typeof voicePassage.$inferInsert
export type VoiceRequest = typeof voiceRequest.$inferSelect
export type NewVoiceRequest = typeof voiceRequest.$inferInsert
