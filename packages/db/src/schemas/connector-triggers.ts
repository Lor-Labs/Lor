import { relations } from "drizzle-orm"
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { channel } from "./channels"
import { integrationConnection } from "./integration-connections"

// Act rate-shape defaults. Exported so the API's "not configured yet" event
// rows and the settings UI show the same numbers a new trigger would get.
export const ACT_DEFAULTS = {
  windowSeconds: 300,
  hourlyRunCap: 3,
  dailyRunCap: 20,
} as const

// A trigger: one connector event kind (e.g. GitHub "pr_merged") anchored to a
// channel, fanning out to effects — POST (message into the channel), Remember
// (summarize + embed into `source`), Act (unattended agent run; column
// reserved, executed in a later phase). No row = that event is off. `event`
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
    post: boolean("post").notNull().default(true),
    remember: boolean("remember").notNull().default(false),
    // Optional steering for Remember's summarize pass.
    rememberHint: text("remember_hint"),
    // Act instructions — null = Act off.
    actInstructions: text("act_instructions"),
    enabled: boolean("enabled").notNull().default(true),
    // Act rate shape. The window coalesces a burst into ONE run: the first
    // delivery opens it (actWindowOpenedAt), everything arriving before it
    // closes joins the same batch. 0 = no batching, one run per delivery.
    // See reference/automation-primitives.md §5.
    actWindowSeconds: integer("act_window_seconds")
      .notNull()
      .default(ACT_DEFAULTS.windowSeconds),
    actWindowOpenedAt: timestamp("act_window_opened_at"),
    // Backstops for Act, counted over rolling windows. Hourly keeps a burst
    // from eating the whole day's budget; daily is the outer fuse.
    hourlyRunCap: integer("hourly_run_cap")
      .notNull()
      .default(ACT_DEFAULTS.hourlyRunCap),
    dailyRunCap: integer("daily_run_cap")
      .notNull()
      .default(ACT_DEFAULTS.dailyRunCap),
  },
  (table) => [
    // Explicit name: the auto-generated one exceeds Postgres's 63-byte limit.
    foreignKey({
      columns: [table.connectionId],
      foreignColumns: [integrationConnection.id],
      name: "connector_trigger_connection_fk",
    }).onDelete("cascade"),
    // One trigger per (connection, event) — multi-channel fan-out for the same
    // event is a later relaxation (reference/automation-primitives.md §8).
    uniqueIndex("connector_trigger_connection_event_uidx").on(
      table.connectionId,
      table.event
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
