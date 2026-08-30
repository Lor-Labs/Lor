import { relations } from "drizzle-orm"
import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { channel } from "./channels"
import { message } from "./messages"
import { user } from "./users"

// Per-user per-thread read cursor. Thread replies don't advance
// channel_read_state, so thread-activity freshness ("new replies in thread")
// is judged against this row instead — it survives reloads and syncs across
// devices, unlike the old client-local dismiss set.
export const threadReadState = pgTable(
  "thread_read_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadRootId: uuid("thread_root_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("threadReadState_thread_user_uidx").on(
      table.threadRootId,
      table.userId
    ),
    index("threadReadState_user_channel_idx").on(table.userId, table.channelId),
  ]
)

export const threadReadStateRelations = relations(
  threadReadState,
  ({ one }) => ({
    threadRoot: one(message, {
      fields: [threadReadState.threadRootId],
      references: [message.id],
    }),
    channel: one(channel, {
      fields: [threadReadState.channelId],
      references: [channel.id],
    }),
    user: one(user, {
      fields: [threadReadState.userId],
      references: [user.id],
    }),
  })
)
