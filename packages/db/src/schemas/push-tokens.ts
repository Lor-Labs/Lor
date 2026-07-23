import { relations } from "drizzle-orm"
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { user } from "./users"

export const pushTokenPlatformEnum = pgEnum("push_token_platform", [
  "ios",
  "android",
])

export const pushToken = pgTable(
  "push_token",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: pushTokenPlatformEnum("platform").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("pushToken_userId_idx").on(table.userId)]
)

export const selectPushTokenSchema = createSelectSchema(pushToken)
export const insertPushTokenSchema = createInsertSchema(pushToken).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
})

export const pushTokenRelations = relations(pushToken, ({ one }) => ({
  user: one(user, {
    fields: [pushToken.userId],
    references: [user.id],
  }),
}))
