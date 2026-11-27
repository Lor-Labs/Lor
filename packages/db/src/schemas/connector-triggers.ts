import { relations } from "drizzle-orm"
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { agent } from "./agents"
import { channel } from "./channels"
import { integrationConnection } from "./integration-connections"
import { user } from "./users"

// Act rate-shape defaults. Exported so the API's "not configured yet" event
// rows and the settings UI show the same numbers a new trigger would get.
export const ACT_DEFAULTS = {
  windowSeconds: 300,
} as const

// Where an Act run goes (reference/act-sessions-runbook.md): a new session
// per run, the session of the event's subject (same PR, issue, record), or
// the trigger's one ongoing session.
export const actSessionModeEnum = pgEnum("act_session_mode", [
  "per_event",
  "per_subject",
  "ongoing",
])

// A listener (reference/agents-and-chats.md, decisions 40 and 42): one
// connector event kind (e.g. GitHub "pr_merged") an agent listens to, anchored
// to the chat the agent reports in, fanning out to effects — POST (message into
// that chat) and Act (wake the agent). Connected items are ingested into `source` whether
// or not a trigger exists. No row = nobody listens to that event. `event`
// keys are declared in the @repo/connectors registry (CONNECTOR_EVENTS) and
// validated at the API layer. See reference/automation-primitives.md.
export const connectorTrigger = pgTable(
  "connector_trigger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    connectionId: uuid("connection_id").notNull(),
    event: text("event").notNull(),
    // The anchor: target and scope of every effect (POST target, Act toolset).
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    // The agent that hears the event: it is woken in its own conversation
    // and reports in `channelId`. Null: the chat's first agent, as before
    // listeners named one.
    agentId: uuid("agent_id").references(() => agent.id, {
      onDelete: "set null",
    }),
    // A plain-language condition Jev checks against each event before the
    // agent is woken or anything is posted ("is this a failed deploy on
    // main?"). Null: every event passes.
    filter: text("filter"),
    post: boolean("post").notNull().default(true),
    // Whether the posted event pings the people in the chat. Off: it shows
    // as unread and sends no notification; the agent's own message pings.
    notify: boolean("notify").notNull().default(false),
    // Act instructions — null = Act off.
    actInstructions: text("act_instructions"),
    actSessionMode: actSessionModeEnum("act_session_mode")
      .notNull()
      .default("per_event"),
    // Code mode: Act starts code sessions on this repo and branch. Null =
    // chat sessions.
    actRepoFullName: text("act_repo_full_name"),
    actBaseBranch: text("act_base_branch"),
    enabled: boolean("enabled").notNull().default(true),
    // Who last saved the trigger's effects: the person asked to approve on a
    // turn its events start (reference/always-on-agents.md §5).
    configuredById: uuid("configured_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Act rate shape. The window coalesces a burst into ONE run: the first
    // delivery opens it (actWindowOpenedAt), everything arriving before it
    // closes joins the same batch. 0 = no batching, one run per delivery.
    // See reference/automation-primitives.md §5.
    actWindowSeconds: integer("act_window_seconds")
      .notNull()
      .default(ACT_DEFAULTS.windowSeconds),
    actWindowOpenedAt: timestamp("act_window_opened_at"),
    // When the open window's flush job is expected to run. A blocked batch
    // pushes this forward as it re-arms, which is what lets the recovery sweep
    // tell "the flush job was lost" from "the batch is legitimately waiting".
    actFlushDueAt: timestamp("act_flush_due_at"),
  },
  (table) => [
    // Explicit name: the auto-generated one exceeds Postgres's 63-byte limit.
    foreignKey({
      columns: [table.connectionId],
      foreignColumns: [integrationConnection.id],
      name: "connector_trigger_connection_fk",
    }).onDelete("cascade"),
    // Several agents can listen to one event, each once
    // (reference/agents-and-chats.md, decision 42). Rows with no agent are
    // distinct to Postgres: the API keeps those to one per event.
    uniqueIndex("connector_trigger_connection_event_agent_uidx").on(
      table.connectionId,
      table.event,
      table.agentId
    ),
    index("connector_trigger_connection_idx").on(table.connectionId),
    index("connector_trigger_channel_idx").on(table.channelId),
  ]
)

export const connectorTriggerRelations = relations(
  connectorTrigger,
  ({ one }) => ({
    connection: one(integrationConnection, {
      fields: [connectorTrigger.connectionId],
      references: [integrationConnection.id],
    }),
    channel: one(channel, {
      fields: [connectorTrigger.channelId],
      references: [channel.id],
    }),
  })
)

export type ConnectorTrigger = typeof connectorTrigger.$inferSelect
export type ActSessionMode = (typeof actSessionModeEnum.enumValues)[number]
