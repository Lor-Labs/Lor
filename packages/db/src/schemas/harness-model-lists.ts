import { jsonb, pgTable, timestamp } from "drizzle-orm/pg-core"
import { harnessKindEnum } from "./agent-sessions"
import type { ReportedHarnessModel } from "./personal-accounts"

// The models a harness offered on its last turn, for the composer's picker,
// where the list is Lor's and not the person's: Codex, on Lor's Gateway key.
// Claude Code's is per person, on personal_account.models.
export const harnessModelList = pgTable("harness_model_list", {
  harness: harnessKindEnum("harness").primaryKey(),
  models: jsonb("models").$type<ReportedHarnessModel[]>().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})
