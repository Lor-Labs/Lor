import { relations } from "drizzle-orm"
import {
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { channel } from "./channels"
import { user } from "./users"

// A person in a chat, with what is theirs alone about it
// (reference/agents-and-chats.md, decisions 35 and 36). Chats are open and
// hidden: a row puts the chat in that person's list, and anyone else who can
// see the channel finds it and joins. Not access: who can see a channel is
// its audience (`channel_member` for private ones, queries/channel-access.ts).
export const chatMember = pgTable(
  "chat_member",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Pinned chats lead the list, in the order they were pinned.
    pinnedAt: timestamp("pinned_at"),
    // Put away by this person. A message after this time brings it back.
    hiddenAt: timestamp("hidden_at"),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.userId] }),
    index("chat_member_userId_idx").on(table.userId),
  ]
)

export const chatMemberRelations = relations(chatMember, ({ one }) => ({
  channel: one(channel, {
    fields: [chatMember.channelId],
    references: [channel.id],
  }),
  user: one(user, {
    fields: [chatMember.userId],
    references: [user.id],
  }),
}))
