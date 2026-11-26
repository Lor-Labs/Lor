import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { agent } from "./agents"
import { channel } from "./channels"
import { message } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

// A Discord server connected to a workspace (reference/agents-and-chats.md,
// decision 51): connected once, with a code from Lor's Connectors run as
// `/lor link` there, after which its channels can be made places.
export const discordGuild = pgTable(
  "discord_guild",
  {
    guildId: text("guild_id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name"),
    connectedById: uuid("connected_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("discord_guild_workspaceId_idx").on(table.workspaceId)]
)

// A place in Discord: the Discord channel behind a `channel` row of kind
// "place" (decisions 24 and 51). People talk in Discord, Lor keeps a copy
// for the agents in it, and each agent posts there through a webhook of its
// own (`discord_agent_webhook`). `webhookId` is the first one made and only
// tells one link from a later one (`withDiscordLinkLock`). The creature and
// role columns are from when a chat had one agent: `discord-places.ts`
// copies them to the per-agent tables once, and nothing reads them after.
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
    // A key for the still the webhook's avatar shows (`stillKey`), so a change
    // of creature or of its drawing re-uploads it.
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

// The role people mention an agent by in a Discord server (@Inky): one per
// agent and server, whichever of its channels the agent is in, held by the
// bot so it pings no one, renamed with the agent.
export const discordAgentRole = pgTable(
  "discord_agent_role",
  {
    guildId: text("guild_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull(),
    roleName: text("role_name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.agentId] }),
    uniqueIndex("discord_agent_role_roleId_uidx").on(table.roleId),
  ]
)

// The webhook an agent posts through in one place, wearing its name and
// face, so several agents in a Discord channel each post as themselves.
export const discordAgentWebhook = pgTable(
  "discord_agent_webhook",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    webhookId: text("webhook_id").notNull(),
    // Encrypted at rest (AES-256-GCM, INTEGRATION_ENCRYPTION_KEY).
    webhookToken: text("webhook_token").notNull(),
    // A key for the still its avatar shows (`stillKey`), so a change of
    // creature or of its drawing re-uploads it.
    webhookCreature: text("webhook_creature"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.agentId] }),
    uniqueIndex("discord_agent_webhook_webhookId_uidx").on(table.webhookId),
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

// A Discord thread under a linked channel and the Lor thread that mirrors
// it: its root is the Lor copy of the thread's starter message, or of its
// first message when the starter was never mirrored.
export const discordThread = pgTable("discord_thread", {
  discordThreadId: text("discord_thread_id").primaryKey(),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channel.id, { onDelete: "cascade" }),
  threadRootId: uuid("thread_root_id")
    .notNull()
    .unique()
    .references(() => message.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})
