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
import { createSelectSchema } from "drizzle-zod"
import { user } from "./users"
import { workspace } from "./workspaces"

// Workspace instructions ("LOR.md"): immutable version rows, exactly one
// active per workspace. Owner/admin direct edits activate immediately; agent
// proposals stay pending until a human approves that exact version.
// See reference/agent-harness.md (LOR.md).
export const workspaceInstructionsStateEnum = pgEnum(
  "workspace_instructions_state",
  ["active", "pending", "rejected", "superseded"]
)

export const workspaceInstructionsAuthorEnum = pgEnum(
  "workspace_instructions_author",
  ["user", "agent"]
)

export const workspaceInstructions = pgTable(
  "workspace_instructions",
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
    version: integer("version").notNull(),
    content: text("content").notNull(),
    state: workspaceInstructionsStateEnum("state").notNull(),
    authorType: workspaceInstructionsAuthorEnum("author_type").notNull(),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The active version this was written against; approval is guarded on it
    // still being active so concurrent changes conflict instead of merging.
    baseVersion: integer("base_version"),
    rationale: text("rationale"),
    approvedByUserId: uuid("approved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    rejectedByUserId: uuid("rejected_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("workspaceInstructions_workspace_version_uidx").on(
      table.workspaceId,
      table.version
    ),
    uniqueIndex("workspaceInstructions_active_uidx")
      .on(table.workspaceId)
      .where(sql`state = 'active'`),
    index("workspaceInstructions_workspace_state_idx").on(
      table.workspaceId,
      table.state
    ),
  ]
)

export const workspaceInstructionsRelations = relations(
  workspaceInstructions,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspaceInstructions.workspaceId],
      references: [workspace.id],
    }),
    author: one(user, {
      fields: [workspaceInstructions.authorUserId],
      references: [user.id],
    }),
  })
)

export const selectWorkspaceInstructionsSchema = createSelectSchema(
  workspaceInstructions
)

// Prompt-budget framing, so the cap reads in the same unit the cost is paid
// in. No tokenizer dependency — ~4 chars/token is the standard estimate; the
// validator labels it as an estimate.
export const WORKSPACE_INSTRUCTIONS_MAX_TOKENS = 2000

export function estimateInstructionsTokens(content: string): number {
  return Math.ceil(content.length / 4)
}

// Content heuristics for credentials that must never reach a model prompt.
// Checked on write (reject) and again on injection (skip + log) — fail closed.
const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "a private key" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: "an AWS access key" },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, label: "an API key" },
  {
    pattern: /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{36,}\b/,
    label: "a GitHub token",
  },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/, label: "a GitHub token" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: "a Slack token" },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+/,
    label: "a JWT",
  },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i, label: "a bearer token" },
]

export type WorkspaceInstructionsValidation =
  | { ok: true }
  | { ok: false; reason: string }

export function validateWorkspaceInstructionsContent(
  content: string
): WorkspaceInstructionsValidation {
  const tokens = estimateInstructionsTokens(content)
  if (tokens > WORKSPACE_INSTRUCTIONS_MAX_TOKENS) {
    return {
      ok: false,
      reason: `Instructions are roughly ${tokens} tokens; the limit is ${WORKSPACE_INSTRUCTIONS_MAX_TOKENS}. Trim them down.`,
    }
  }
  for (const { pattern, label } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      return {
        ok: false,
        reason: `Instructions appear to contain ${label} — remove any credentials or secrets.`,
      }
    }
  }
  return { ok: true }
}
