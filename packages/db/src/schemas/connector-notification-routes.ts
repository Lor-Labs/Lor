import { relations } from "drizzle-orm"
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { channel } from "./channels"
import { integrationConnection } from "./integration-connections"

// Routes one connector event kind (e.g. GitHub "pr_merged") to a channel. No
// row = that event isn't posted. `event` keys are declared in the
// @repo/connectors registry (CONNECTOR_EVENTS) and validated at the API layer.
export const connectorNotificationRoute = pgTable(
  "connector_notification_route",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnection.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("connector_notification_route_connection_event_uidx").on(
      table.connectionId,
      table.event
    ),
    index("connector_notification_route_connection_idx").on(table.connectionId),
    index("connector_notification_route_channel_idx").on(table.channelId),
  ]
)

export const connectorNotificationRouteRelations = relations(
  connectorNotificationRoute,
  ({ one }) => ({
    connection: one(integrationConnection, {
      fields: [connectorNotificationRoute.connectionId],
      references: [integrationConnection.id],
    }),
    channel: one(channel, {
      fields: [connectorNotificationRoute.channelId],
      references: [channel.id],
    }),
  })
)

export type ConnectorNotificationRoute =
  typeof connectorNotificationRoute.$inferSelect
