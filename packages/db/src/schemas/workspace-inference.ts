import type { InferenceKeyConfig } from "@repo/utils/inference"
import {
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./users"
import { workspace } from "./workspaces"

// A workspace's own AI provider credential, one per provider. Replacing it
// gives it a new keyId, which stops runs pinned to the old one.
// encryptedKey holds the raw API key for Anthropic/OpenAI and the encrypted
// JSON credential for Azure, Vertex and Bedrock; config is its non-secret
// part (endpoint, region, deployments) for settings and the model list.
export const workspaceInferenceKey = pgTable(
  "workspace_inference_key",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["anthropic", "openai", "azure", "google-vertex", "amazon-bedrock"],
    }).notNull(),
    keyId: uuid("key_id").defaultRandom().notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    lastFour: text("last_four").notNull(),
    config: jsonb("config").$type<InferenceKeyConfig>(),
    createdById: uuid("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.provider] })]
)
