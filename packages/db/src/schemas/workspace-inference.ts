import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { workspace } from "./workspaces"

export const workspaceInferenceKey = pgTable("workspace_inference_key", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  keyId: uuid("key_id").defaultRandom().notNull(),
  provider: text("provider", { enum: ["anthropic", "openai"] }).notNull(),
  model: text("model").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  lastFour: text("last_four").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})
