import {
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { workspace } from "./workspaces"

// Sandbox time ledger: one row per sandbox per hour, from the provider's
// billing data (Blaxel sandbox_compute_runtime_gbs). Credits debit the
// workspace's shared credit pool; providerCostUsd is what Lor paid.
export const sandboxUsage = pgTable(
  "sandbox_usage",
  {
    sandboxName: text("sandbox_name").notNull(),
    hourStart: timestamp("hour_start", { withTimezone: true }).notNull(),
    // The ledger outlives the workspace.
    workspaceId: uuid("workspace_id").references(() => workspace.id, {
      onDelete: "set null",
    }),
    // Latest totals for the hour; the provider keeps adding until it closes.
    usageGbs: doublePrecision("usage_gbs").notNull().default(0),
    providerCostUsd: doublePrecision("provider_cost_usd").notNull().default(0),
    creditsCharged: integer("credits_charged").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sandboxName, table.hourStart] }),
    index("sandbox_usage_workspace_hour_idx").on(
      table.workspaceId,
      table.hourStart
    ),
  ]
)
