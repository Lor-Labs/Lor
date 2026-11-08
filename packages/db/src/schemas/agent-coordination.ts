import { relations } from "drizzle-orm"
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { agentSession } from "./agent-sessions"
import { workspace } from "./workspaces"

// The shared coordination log for code sessions on one repository: what each
// session's agent said it was about to change, and the overlap notes it was
// given. Append-only by design: nothing updates or deletes a row (sessions'
// cascades aside), so people can trust it as the record of who planned what.
// reference/agent-coordination.md
export const COORDINATION_ENTRY_KINDS = ["intent", "overlap"] as const
export const coordinationEntryKindEnum = pgEnum(
  "coordination_entry_kind",
  COORDINATION_ENTRY_KINDS
)

export const agentCoordinationEntry = pgTable(
  "agent_coordination_entry",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    repoFullName: text("repo_full_name").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSession.id, { onDelete: "cascade" }),
    kind: coordinationEntryKindEnum("kind").notNull(),
    // Repo-relative paths the entry is about.
    paths: text("paths").array().notNull(),
    // intent: the agent's own words on what it is about to change and why.
    // overlap: the other session it was told about.
    summary: text("summary").notNull(),
    otherSessionId: uuid("other_session_id").references(() => agentSession.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("agentCoordinationEntry_workspace_repo_createdAt_idx").on(
      table.workspaceId,
      table.repoFullName,
      table.createdAt
    ),
    index("agentCoordinationEntry_sessionId_idx").on(table.sessionId),
    index("agentCoordinationEntry_paths_idx").using("gin", table.paths),
  ]
)

export const agentCoordinationEntryRelations = relations(
  agentCoordinationEntry,
  ({ one }) => ({
    session: one(agentSession, {
      fields: [agentCoordinationEntry.sessionId],
      references: [agentSession.id],
    }),
    workspace: one(workspace, {
      fields: [agentCoordinationEntry.workspaceId],
      references: [workspace.id],
    }),
  })
)
