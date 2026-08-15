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
    // Backstop for Act: max triggered runs per day.
    dailyRunCap: integer("daily_run_cap").notNull().default(100),
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
