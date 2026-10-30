import { relations } from "drizzle-orm"
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./users"
import { workspace } from "./workspaces"

// Environments for code sessions (reference/dev-environment-runbook.md §2):
// a named set of repos, each with env files Lor writes into the session's
// work folder every turn. The model allows several repos per environment;
// the API and UI allow one until sessions can hold several repos.

// How a variable reaches the sandbox. `file`: written into its env file, so
// Lor and the terminal can read it. `proxy` (later): Lor's egress proxy fills
// it into requests to its hosts and the sandbox never sees the value.
export const environmentDeliveryEnum = pgEnum("environment_delivery", [
  "file",
  "proxy",
])

export const environment = pgTable(
  "environment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdById: uuid("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedById: uuid("updated_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("environment_workspace_name_uidx").on(
      table.workspaceId,
      table.name
    ),
  ]
)

export const environmentRepo = pgTable(
  "environment_repo",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    // GitHub owner/repo, as code sessions store it.
    repoFullName: text("repo_full_name").notNull(),
  },
  (table) => [
    uniqueIndex("environment_repo_env_repo_uidx").on(
      table.environmentId,
      table.repoFullName
    ),
    index("environment_repo_repo_idx").on(table.repoFullName),
  ]
)

export const environmentFile = pgTable(
  "environment_file",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environmentRepoId: uuid("environment_repo_id")
      .notNull()
      .references(() => environmentRepo.id, { onDelete: "cascade" }),
    // Relative to the repo root, e.g. `.env.local` or `apps/web/.env`.
    path: text("path").notNull(),
  },
  (table) => [
    uniqueIndex("environment_file_repo_path_uidx").on(
      table.environmentRepoId,
      table.path
    ),
  ]
)

export const environmentVariable = pgTable(
  "environment_variable",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environmentFileId: uuid("environment_file_id")
      .notNull()
      .references(() => environmentFile.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    // AES-256-GCM ciphertext (INTEGRATION_ENCRYPTION_KEY); the API returns
    // keys only, and values to people with environment:manage on reveal.
    value: text("value").notNull(),
    delivery: environmentDeliveryEnum("delivery").notNull().default("file"),
    // Proxy delivery: the hosts that receive the value.
    hosts: text("hosts").array().notNull().default([]),
  },
  (table) => [
    uniqueIndex("environment_variable_file_key_uidx").on(
      table.environmentFileId,
      table.key
    ),
  ]
)

export const environmentRelations = relations(environment, ({ many }) => ({
  repos: many(environmentRepo),
}))

export const environmentRepoRelations = relations(
  environmentRepo,
  ({ one, many }) => ({
    environment: one(environment, {
      fields: [environmentRepo.environmentId],
      references: [environment.id],
    }),
    files: many(environmentFile),
  })
)

export const environmentFileRelations = relations(
  environmentFile,
  ({ one, many }) => ({
    repo: one(environmentRepo, {
      fields: [environmentFile.environmentRepoId],
      references: [environmentRepo.id],
    }),
    variables: many(environmentVariable),
  })
)

export const environmentVariableRelations = relations(
  environmentVariable,
  ({ one }) => ({
    file: one(environmentFile, {
      fields: [environmentVariable.environmentFileId],
      references: [environmentFile.id],
    }),
  })
)

export type Environment = typeof environment.$inferSelect
export type EnvironmentRepo = typeof environmentRepo.$inferSelect
export type EnvironmentFile = typeof environmentFile.$inferSelect
export type EnvironmentVariable = typeof environmentVariable.$inferSelect
export type EnvironmentDelivery =
  (typeof environmentDeliveryEnum.enumValues)[number]
