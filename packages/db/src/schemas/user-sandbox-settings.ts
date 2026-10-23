import { relations } from "drizzle-orm"
import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { user } from "./users"

// How Lor runs `bash`, `write` and `edit` in its sandbox for turns this person
// starts: ask before each call, ask only for risky ones, or never ask.
// Read-only tools never ask (reference/planned/pi-harness-runbook.md §4.6).
export const sandboxModeEnum = pgEnum("sandbox_mode", [
  "manual",
  "auto",
  "bypass",
])

export const userSandboxSettings = pgTable("user_sandbox_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  sandboxMode: sandboxModeEnum("sandbox_mode").default("auto").notNull(),
})

export const sandboxSettingsResponseSchema = createSelectSchema(
  userSandboxSettings
).pick({ sandboxMode: true })

export const updateSandboxSettingsSchema = createInsertSchema(
  userSandboxSettings
).pick({ sandboxMode: true })

export const userSandboxSettingsRelations = relations(
  userSandboxSettings,
  ({ one }) => ({
    user: one(user, {
      fields: [userSandboxSettings.userId],
      references: [user.id],
    }),
  })
)

export type SandboxMode = (typeof sandboxModeEnum.enumValues)[number]
// A person's sandbox mode, or autonomous for Loop and Act runs (no one to ask).
export type TurnSandboxMode = SandboxMode | "autonomous"
