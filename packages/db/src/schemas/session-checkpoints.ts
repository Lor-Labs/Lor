import { relations } from "drizzle-orm"
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { agentRun } from "./agent-runs"
import { agentSession } from "./agent-sessions"

// A code session's work folder saved to Pierre Code Storage
// (reference/planned/code-sessions-runbook.md, chunk 5): a commit whose tree
// is the work folder and whose parents are the previous checkpoint and the
// session's HEAD, on the branch session/<sessionId>. A lost sandbox is
// rebuilt from the newest one.
export const sessionCheckpoint = pgTable(
  "session_checkpoint",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSession.id, { onDelete: "cascade" }),
    // The run whose completed turn it saves; null for a person's action.
    runId: uuid("run_id").references(() => agentRun.id, {
      onDelete: "set null",
    }),
    // The Code Storage repo: <workspaceId>/<owner>/<repo>.
    storageRepo: text("storage_repo").notNull(),
    sha: text("sha").notNull(),
    treeSha: text("tree_sha").notNull(),
    // What a restore puts back: the checked-out branch at HEAD, and its
    // remote-tracking ref (what GitHub last had) for Push and Pull.
    headSha: text("head_sha").notNull(),
    branch: text("branch"),
    upstreamSha: text("upstream_sha"),
  },
  (table) => [
    index("session_checkpoint_session_created_idx").on(
      table.sessionId,
      table.createdAt
    ),
  ]
)

export const sessionCheckpointRelations = relations(
  sessionCheckpoint,
  ({ one }) => ({
    session: one(agentSession, {
      fields: [sessionCheckpoint.sessionId],
      references: [agentSession.id],
    }),
  })
)
