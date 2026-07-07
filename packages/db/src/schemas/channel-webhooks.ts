import { relations } from "drizzle-orm"
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { channel } from "./channels"
import { user } from "./users"
import { workspace } from "./workspaces"

// Discord-style inbound webhook: POST /v1/webhooks/:id/:token drops a message
// into the channel. The token is the only credential — treat the URL as a
// secret. Webhook messages are canonical chat content (no `source` row), so
// they stay searchable, unlike connector notifications.
export const channelWebhook = pgTable(
  "channel_webhook",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Public asset URL (our bucket) shown as the message avatar.
    avatarUrl: text("avatar_url"),
    token: text("token").notNull(),
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("channel_webhook_token_uidx").on(table.token),
    index("channel_webhook_channel_idx").on(table.channelId),
  ]
)

export const channelWebhookRelations = relations(channelWebhook, ({ one }) => ({
  channel: one(channel, {
    fields: [channelWebhook.channelId],
    references: [channel.id],
  }),
  workspace: one(workspace, {
    fields: [channelWebhook.workspaceId],
    references: [workspace.id],
  }),
}))

export type ChannelWebhook = typeof channelWebhook.$inferSelect
export type NewChannelWebhook = typeof channelWebhook.$inferInsert
