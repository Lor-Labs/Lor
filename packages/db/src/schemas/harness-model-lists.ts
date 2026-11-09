import { jsonb, pgTable, timestamp } from "drizzle-orm/pg-core"
import { harnessKindEnum } from "./agent-sessions"
import type { ReportedHarnessModel } from "./personal-accounts"

// The models a harness offered on anyone's last turn: Codex's, the composer's
// starting list for people whose own Codex hasn't reported theirs yet (that
// is per person, on personal_account.models, like Claude Code's).
export const harnessModelList = pgTable("harness_model_list", {
  harness: harnessKindEnum("harness").primaryKey(),
  models: jsonb("models").$type<ReportedHarnessModel[]>().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})
