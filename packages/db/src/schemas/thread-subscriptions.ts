import { relations } from "drizzle-orm"
import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { message } from "./messages"
import { user } from "./users"

// Who follows a thread: a Lor session, a human thread, or a call chat. Drives
// the session sidebar and thread notifications. Starting, being mentioned,
// sending, acting, or being added subscribes; unsubscribing deletes the row.
export const threadSubscription = pgTable(
  "thread_subscription",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    threadRootId: uuid("thread_root_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("thread_subscription_threadRootId_userId_uidx").on(
      table.threadRootId,
      table.userId
    ),
    index("thread_subscription_userId_idx").on(table.userId),
  ]
)

export const threadSubscriptionRelations = relations(
  threadSubscription,
  ({ one }) => ({
    threadRoot: one(message, {
      fields: [threadSubscription.threadRootId],
      references: [message.id],
    }),
    user: one(user, {
      fields: [threadSubscription.userId],
      references: [user.id],
    }),
  })
)

export type ThreadSubscription = typeof threadSubscription.$inferSelect
