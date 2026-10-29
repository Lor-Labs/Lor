import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./users"
import { workspace } from "./workspaces"

// A workspace's own Anthropic/OpenAI API key, one per provider. Replacing a
// key gives it a new keyId, which stops runs pinned to the old one.
export const workspaceInferenceKey = pgTable(
  "workspace_inference_key",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["anthropic", "openai"] }).notNull(),
    keyId: uuid("key_id").defaultRandom().notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    lastFour: text("last_four").notNull(),
    createdById: uuid("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.provider] })]
)
