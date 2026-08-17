import { relations, sql } from "drizzle-orm"
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
    // What the Act effect would consume for this delivery, stored only when the
    // trigger batches (actWindowSeconds > 0) because the flush runs later and
    // has to rebuild the batch from these rows. `payload` above stays the raw
    // inbound body; this is the normalized text + the source label.
    actPayload: text("act_payload"),
    actLabel: text("act_label"),
    // Which effects this delivery actually kicked off.
    posted: boolean("posted").notNull().default(false),
    remembered: boolean("remembered").notNull().default(false),
    // The triggered agent run. Many deliveries share one run when batched.
    runId: uuid("run_id"),
  },
  (table) => [
    index("trigger_delivery_trigger_created_idx").on(
      table.triggerId,
      table.createdAt
    ),
    // The flush's claim query: unclaimed deliveries for a trigger, newest
    // first.
    index("trigger_delivery_unclaimed_idx")
      .on(table.triggerId, table.createdAt)
      .where(sql`run_id is null`),
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
