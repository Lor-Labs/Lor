import { relations, sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { agentRun } from "./agent-runs"
import { agentSession } from "./agent-sessions"
import { voiceSession } from "./voice"
import { workspace } from "./workspaces"

// Harnesses that can run a conversation. Claude Code and Codex join in
// phase 2 (reference/planned/harness-sessions.md).
export const harnessKindEnum = pgEnum("harness_kind", ["pi"])

// The harness's state for one conversation: a Lor session or a voice call.
// Postgres is the authority for the harness log Pi resumes from; sandbox and
// worker copies are runtime copies. Saved once per completed turn and at
// approval/stop; every save is guarded by the run's lease and the expected
// previous head (reference/planned/pi-harness-runbook.md §4.3).
export const harnessState = pgTable(
  "harness_state",
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
    // Exactly one owner: a Lor session, or a voice call (voice runs have no
    // agent_session).
    sessionId: uuid("session_id").references(() => agentSession.id, {
      onDelete: "cascade",
    }),
    voiceSessionId: uuid("voice_session_id").references(() => voiceSession.id, {
      onDelete: "cascade",
    }),

    // A conversation never changes harness.
    kind: harnessKindEnum("kind").notNull(),
    // e.g. "1.0.160". A pending continuation only resumes on the adapter
    // version that wrote it; after an upgrade its approvals expire instead.
    adapterVersion: text("adapter_version").notNull(),
    // Pi's session file format (CURRENT_SESSION_VERSION). Pi converts older
    // files when it opens them; only a newer format (a downgrade) is refused.
    formatVersion: integer("format_version").notNull(),

    // Saved head of the log. Saves compare-and-swap on sha256 and length.
    // harnessSessionId and logFileName are Pi's own header id and file name.
    harnessSessionId: text("harness_session_id").notNull(),
    logFileName: text("log_file_name").notNull(),
    entryCount: integer("entry_count").notNull(),
    headEntryId: text("head_entry_id").notNull(),
    byteLength: integer("byte_length").notNull(),
    sha256: text("sha256").notNull(),
    chunkCount: integer("chunk_count").notNull(),

    // The harness continue-turn state while approvals are pending, stored
    // verbatim (it carries finished sibling tool results); null otherwise.
    // Opaque by design: the adapter owns its shape.
    continuation: jsonb("continuation").$type<unknown>(),

    lastRunId: uuid("last_run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("harness_state_sessionId_uidx")
      .on(table.sessionId)
      .where(sql`session_id is not null`),
    uniqueIndex("harness_state_voiceSessionId_uidx")
      .on(table.voiceSessionId)
      .where(sql`voice_session_id is not null`),
    index("harness_state_workspaceId_idx").on(table.workspaceId),
    check(
      "harness_state_one_owner_check",
      sql`num_nonnulls(${table.sessionId}, ${table.voiceSessionId}) = 1`
    ),
  ]
)

// The harness log (Pi's UTF-8 JSONL session file), stored append-only with one
// chunk per save. Loading concatenates chunks in seq order and checks length
// and sha256 against the head; a gap or mismatch fails the run instead of
// letting Pi start a blank conversation.
export const harnessLog = pgTable(
  "harness_log",
  {
    harnessStateId: uuid("harness_state_id")
      .notNull()
      .references(() => harnessState.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    byteOffset: integer("byte_offset").notNull(),
    content: text("content").notNull(),
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.harnessStateId, table.seq] })]
)

export const harnessStateRelations = relations(
  harnessState,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [harnessState.workspaceId],
      references: [workspace.id],
    }),
    session: one(agentSession, {
      fields: [harnessState.sessionId],
      references: [agentSession.id],
    }),
    voiceSession: one(voiceSession, {
      fields: [harnessState.voiceSessionId],
      references: [voiceSession.id],
    }),
    log: many(harnessLog),
  })
)

export const harnessLogRelations = relations(harnessLog, ({ one }) => ({
  harnessState: one(harnessState, {
    fields: [harnessLog.harnessStateId],
    references: [harnessState.id],
  }),
}))

export type HarnessState = typeof harnessState.$inferSelect
export type NewHarnessState = typeof harnessState.$inferInsert
export type HarnessLog = typeof harnessLog.$inferSelect
export type HarnessKind = (typeof harnessKindEnum.enumValues)[number]
