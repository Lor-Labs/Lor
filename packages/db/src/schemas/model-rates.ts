import {
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

// APPEND ONLY — price or conversion changes are new rows with a later
// effectiveFrom, never UPDATEs, so historical spend stays reconstructible.
export const modelRate = pgTable(
  "model_rate",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Gateway slug (creator/model), or "*" as the catch-all for models the
    // gateway fallback serves that we never seeded.
    model: text("model").notNull(),
    inputUsdPerMtok: numeric("input_usd_per_mtok", {
      precision: 12,
      scale: 6,
    }).notNull(),
    cachedInputUsdPerMtok: numeric("cached_input_usd_per_mtok", {
      precision: 12,
      scale: 6,
    }).notNull(),
    outputUsdPerMtok: numeric("output_usd_per_mtok", {
      precision: 12,
      scale: 6,
    }).notNull(),
    // USD cost → credit conversion factor applied at debit time.
    conversionRate: numeric("conversion_rate", { precision: 6, scale: 3 })
      .notNull()
      .default("1"),
    effectiveFrom: timestamp("effective_from").notNull(),
  },
  (table) => [
    uniqueIndex("model_rate_model_effective_uidx").on(
      table.model,
      table.effectiveFrom
    ),
  ]
)

export type ModelRateRow = typeof modelRate.$inferSelect
export type NewModelRateRow = typeof modelRate.$inferInsert
