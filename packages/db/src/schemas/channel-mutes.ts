import { relations } from "drizzle-orm"
import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { createSelectSchema } from "drizzle-zod"
import { channel } from "./channels"
import { user } from "./users"

// Row present = channel muted for that user; mutedUntil null = until unmuted.
export const channelMute = pgTable(
  "channel_mute",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mutedUntil: timestamp("muted_until"),
  },
  (table) => [
    uniqueIndex("channelMute_channel_user_uidx").on(
      table.channelId,
      table.userId
    ),
    index("channelMute_userId_idx").on(table.userId),
  ]
)

export const selectChannelMuteSchema = createSelectSchema(channelMute)

export const channelMuteRelations = relations(channelMute, ({ one }) => ({
  channel: one(channel, {
    fields: [channelMute.channelId],
    references: [channel.id],
  }),
  user: one(user, {
    fields: [channelMute.userId],
    references: [user.id],
  }),
}))
