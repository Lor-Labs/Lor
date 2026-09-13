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

// A loop: a scheduled headless Lor run in a channel, repeating on a cron
// schedule until an end condition is met, it's paused, or completed. Postgres
// is the only source of truth for scheduling — a 60s worker sweep claims due
// loops via CAS on nextRunAt; there are no per-loop BullMQ schedulers.
// Runs ride the unattended-run rails with scopeKey = loop.id, so the
// active-scope unique index gives overlap protection and the per-scope
// handoff-note chain gives run-to-run memory. See reference/loops.md.
export const loopStatusEnum = pgEnum("loop_status", [
  // Proposed via the loop card, not yet activated.
  "draft",
  "active",
  "paused",
  "completed",
])

export const loopPausedReasonEnum = pgEnum("loop_paused_reason", [
  "manual",
  "failures",
  "out_of_credits",
])

export const loop = pgTable(
  "loop",
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
    creatorId: uuid("creator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // The loop card message (message type `loop_card`) — the card renders
    // from this row, looked up by cardMessageId like plan.cardMessageId.
    // Nullable: rows created before the card posts (or via future API paths).
    cardMessageId: uuid("card_message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    // The run's brief, injected into every scheduled run's system prompt.
    instructions: text("instructions").notNull(),
    // Cron expression + IANA timezone. Next fires are computed with croner
    // (@repo/merlin/loop-schedule) only at activate/edit/resume/claim.
    schedule: text("schedule").notNull(),
    // Null on drafts = "not pinned yet": Lor only sets it when the
    // conversation establishes one; otherwise the activating user's device
    // timezone is the default at activation (editable there). Activation
    // always persists a concrete tz — active/paused loops never have null.
    timezone: text("timezone"),
    // End modes, one per loop (both null = runs forever; project channels
    // additionally auto-complete when the project archives):
    // - endCondition: free text; injected into the prompt; the model calls
    //   complete_loop when it judges this met (bound only when set).
    // - endAt: hard end date, enforced mechanically by the sweep — a due
    //   fire past it completes the loop instead of running.
    endCondition: text("end_condition"),
    endAt: timestamp("end_at"),
    status: loopStatusEnum("status").notNull().default("draft"),
    pausedReason: loopPausedReasonEnum("paused_reason"),
    // Null unless active. Catch-up policy: a missed schedule fires once and
    // the next fire is computed from now — never a backlog.
    nextRunAt: timestamp("next_run_at"),
    lastRunAt: timestamp("last_run_at"),
    // Terminal run failures (incl. out_of_credits) since the last clean run;
    // auto-pause at 5. Settled by the worker at run settlement, not BullMQ.
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    // Set by the complete_loop tool — the loop's closing summary.
    completedNote: text("completed_note"),
    // Audit trail for consenting to a sub-hourly cadence (recurring cost).
    highFrequencyConfirmedAt: timestamp("high_frequency_confirmed_at"),
    highFrequencyConfirmedBy: uuid("high_frequency_confirmed_by").references(
      () => user.id,
      { onDelete: "set null" }
    ),
  },
  (table) => [
    uniqueIndex("loop_cardMessageId_uidx").on(table.cardMessageId),
    // The sweep probe: due active loops only.
    index("loop_nextRunAt_active_idx")
      .on(table.nextRunAt)
      .where(sql`status = 'active'`),
    index("loop_channelId_status_idx").on(table.channelId, table.status),
    index("loop_workspaceId_createdAt_idx").on(
      table.workspaceId,
      table.createdAt
    ),
  ]
)

export const loopRelations = relations(loop, ({ one }) => ({
  workspace: one(workspace, {
    fields: [loop.workspaceId],
    references: [workspace.id],
  }),
  channel: one(channel, {
    fields: [loop.channelId],
    references: [channel.id],
  }),
  creator: one(user, {
    fields: [loop.creatorId],
    references: [user.id],
  }),
  cardMessage: one(message, {
    fields: [loop.cardMessageId],
    references: [message.id],
  }),
}))

export type Loop = typeof loop.$inferSelect
export type LoopStatus = (typeof loopStatusEnum.enumValues)[number]
export type LoopPausedReason = (typeof loopPausedReasonEnum.enumValues)[number]
