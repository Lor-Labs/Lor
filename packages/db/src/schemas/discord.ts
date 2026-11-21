import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { channel } from "./channels"
import { message } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

// A channel whose chat lives in a Discord channel
// (reference/always-on-agents.md §10, decision 22): people talk in Discord,
// Lor mirrors the conversation read-only, and the agent posts there through
// the webhook the bot made, under its own name and creature.
export const channelDiscordLink = pgTable(
  "channel_discord_link",
  {
    channelId: uuid("channel_id")
      .primaryKey()
      .references(() => channel.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    guildId: text("guild_id").notNull(),
    guildName: text("guild_name"),
    discordChannelId: text("discord_channel_id").notNull(),
    discordChannelName: text("discord_channel_name"),
    webhookId: text("webhook_id").notNull(),
    // Encrypted at rest (AES-256-GCM, INTEGRATION_ENCRYPTION_KEY).
    webhookToken: text("webhook_token").notNull(),
    // The creature the webhook's avatar shows, so a change re-uploads it.
    webhookCreature: text("webhook_creature"),
    // A mentionable role named after the agent, held by the bot, so people
    // can write @Inky; and the name it has, so a rename follows.
    agentRoleId: text("agent_role_id"),
    agentRoleName: text("agent_role_name"),
    linkedById: uuid("linked_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("channel_discord_link_discordChannelId_uidx").on(
      table.discordChannelId
    ),
  ]
)

// A Lor message and the Discord message it mirrors or was posted as: replies
// map both ways, and a redelivered Discord event is not stored twice.
export const discordMessage = pgTable("discord_message", {
  discordMessageId: text("discord_message_id").primaryKey(),
  messageId: uuid("message_id")
    .notNull()
    .unique()
    .references(() => message.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channel.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

// A person's Discord account, linked with `/lor connect`: their Discord
// messages post as them in Lor, and they can decide approvals from Discord.
export const discordAccount = pgTable("discord_account", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  discordUserId: text("discord_user_id").notNull().unique(),
  username: text("username").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})
