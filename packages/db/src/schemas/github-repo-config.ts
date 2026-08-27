import { relations } from "drizzle-orm"
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { integrationConnection } from "./integration-connections"

// Per-repository settings for a GitHub connection. Row present = the repo's
// pull request base branch is overridden (code actions open PRs against it
// instead of the repo's default branch); absent = default branch.
export const githubRepoConfig = pgTable(
  "github_repo_config",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnection.id, { onDelete: "cascade" }),
    repoFullName: text("repo_full_name").notNull(),
    baseBranch: text("base_branch").notNull(),
  },
  (table) => [
    uniqueIndex("githubRepoConfig_connection_repo_uidx").on(
      table.connectionId,
      table.repoFullName
    ),
    index("githubRepoConfig_connection_idx").on(table.connectionId),
  ]
)

export const githubRepoConfigRelations = relations(
  githubRepoConfig,
  ({ one }) => ({
    connection: one(integrationConnection, {
      fields: [githubRepoConfig.connectionId],
      references: [integrationConnection.id],
    }),
  })
)

export type GithubRepoConfig = typeof githubRepoConfig.$inferSelect
