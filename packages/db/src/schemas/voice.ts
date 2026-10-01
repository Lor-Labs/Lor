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
import { message } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

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
    participantId: uuid("participant_id")
      .notNull()
      .references(() => voiceSessionParticipant.id, { onDelete: "cascade" }),
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
    participantId: uuid("participant_id").references(
      () => voiceSessionParticipant.id,
      { onDelete: "cascade" }
    ),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    reason: voiceCaptureGapReasonEnum("reason").notNull(),
  },
  (table) => [
    index("voice_capture_gap_sessionId_startMs_idx").on(
      table.sessionId,
      table.startMs
    ),
  ]
)

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
