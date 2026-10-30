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

// A repo's environment for code sessions (reference/dev-environment-runbook.md):
// env vars Lor writes into the session's work folder each turn. One per
// workspace + repo for now; a later environment group may own several.

// How a variable reaches the sandbox. `file`: written into the env file, so
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
    // GitHub owner/repo, as code sessions store it.
    repoFullName: text("repo_full_name").notNull(),
    // Path of the env file, relative to the repo root.
    fileName: text("file_name").notNull().default(".env.local"),
    updatedById: uuid("updated_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("environment_workspace_repo_uidx").on(
      table.workspaceId,
      table.repoFullName
    ),
  ]
)

export const environmentVariable = pgTable(
  "environment_variable",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    // AES-256-GCM ciphertext (INTEGRATION_ENCRYPTION_KEY); the API returns
    // keys only, and values to people with environment:manage on reveal.
    value: text("value").notNull(),
    delivery: environmentDeliveryEnum("delivery").notNull().default("file"),
    // Proxy delivery: the hosts that receive the value.
    hosts: text("hosts").array().notNull().default([]),
  },
  (table) => [
    uniqueIndex("environment_variable_env_key_uidx").on(
      table.environmentId,
      table.key
    ),
    index("environment_variable_env_idx").on(table.environmentId),
  ]
)

export const environmentRelations = relations(environment, ({ many }) => ({
  variables: many(environmentVariable),
}))

export const environmentVariableRelations = relations(
  environmentVariable,
  ({ one }) => ({
    environment: one(environment, {
      fields: [environmentVariable.environmentId],
      references: [environment.id],
    }),
  })
)

export type Environment = typeof environment.$inferSelect
export type EnvironmentVariable = typeof environmentVariable.$inferSelect
export type EnvironmentDelivery =
  (typeof environmentDeliveryEnum.enumValues)[number]
