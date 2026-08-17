import { relations } from "drizzle-orm"
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { connectorTrigger } from "./connector-triggers"

// One inbound delivery handled by a trigger — the delivery log. For BYO
// webhooks it also stores the capped raw payload: Lor is the system of record
// there (no provider to live-fetch from — the documented exception in
// reference/automation-primitives.md §2). Null payload for first-party
// connector events, whose content lives at the provider.
export const triggerDelivery = pgTable(
  "trigger_delivery",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    triggerId: uuid("trigger_id")
      .notNull()
      .references(() => connectorTrigger.id, { onDelete: "cascade" }),
    payload: text("payload"),
    // Which effects this delivery actually kicked off.
    posted: boolean("posted").notNull().default(false),
    remembered: boolean("remembered").notNull().default(false),
    // The triggered agent run, once Act lands (phase 4).
    runId: uuid("run_id"),
  },
  (table) => [
    index("trigger_delivery_trigger_created_idx").on(
      table.triggerId,
      table.createdAt
    ),
  ]
)

export const triggerDeliveryRelations = relations(
  triggerDelivery,
  ({ one }) => ({
    trigger: one(connectorTrigger, {
      fields: [triggerDelivery.triggerId],
      references: [connectorTrigger.id],
    }),
  })
)

export type TriggerDelivery = typeof triggerDelivery.$inferSelect
