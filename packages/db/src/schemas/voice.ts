import { relations, sql } from "drizzle-orm"
import {
  index,
  pgTable,
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
