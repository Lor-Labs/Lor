import {
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./users"

// Product hints (reference/onboarding.md, Hints). Workspace facts like
// "GitHub is connected" are derived from existing rows; this only records
// that a user has seen a hint.
export const hintKeyEnum = pgEnum("hint_key", [
  "channels_intro",
  "lor_intro",
  "lor_reply",
  "voice_intro",
  "connectors_intro",
])

export type HintKey = (typeof hintKeyEnum.enumValues)[number]

// Per user, not per workspace: a hint learned in one workspace stays learned
// in the next, on every device.
export const hintDismissal = pgTable(
  "hint_dismissal",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: hintKeyEnum("key").notNull(),
    dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("hintDismissal_user_key_uidx").on(table.userId, table.key),
  ]
)
