import { relations } from "drizzle-orm"
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { agentRun } from "./agent-runs"
import { agentSession } from "./agent-sessions"
import { workspace } from "./workspaces"

// What a piece of Lor's work touched, e.g. "session X read LOR-123": recorded
// from tool calls, citations and session context, never by a model. Sessions
// are the first origin; messages, sources and brain pages join later.
// reference/planned/session-memory.md Step 5.
export const TOUCH_KINDS = [
  "message",
  "call",
  "brain_page",
  "artifact",
  "source",
  "github_repo",
  "github_pr",
  "github_issue",
  "linear_issue",
  "notion_page",
  "attio_record",
  "attio_list_entry",
  "attio_task",
  "betterstack_incident",
  "betterstack_error",
  "url",
] as const
export const touchKindEnum = pgEnum("touch_kind", TOUCH_KINDS)

export const TOUCH_ACTIONS = [
  "read",
  "wrote",
  "cited",
  "started_from",
  "mentioned",
] as const
export const touchActionEnum = pgEnum("touch_action", TOUCH_ACTIONS)

export const touch = pgTable(
  "touch",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSession.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    kind: touchKindEnum("kind").notNull(),
    // The item's stable key (session-memory.md "Stable keys"). Text, not an
    // FK: the target may be deleted or never ingested.
    value: text("value").notNull(),
    action: touchActionEnum("action").notNull(),
  },
  (table) => [
    uniqueIndex("touch_session_kind_value_action_uidx").on(
      table.sessionId,
      table.kind,
      table.value,
      table.action
    ),
    index("touch_workspace_kind_value_idx").on(
      table.workspaceId,
      table.kind,
      table.value
    ),
  ]
)

export const touchRelations = relations(touch, ({ one }) => ({
  session: one(agentSession, {
    fields: [touch.sessionId],
    references: [agentSession.id],
  }),
}))

export type TouchKind = (typeof TOUCH_KINDS)[number]
export type TouchAction = (typeof TOUCH_ACTIONS)[number]
