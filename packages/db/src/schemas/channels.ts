import { relations } from "drizzle-orm"
import {
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod"
import { message } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

export const channelTypeEnum = pgEnum("channel_type", [
  "text",
  "voice",
  "dm",
  "group_dm",
  "category",
])

// Channel audience: "workspace" = every workspace member (default);
// "members" = requires a channel_member row on the access container (the
// parent category, else the channel itself) — one member list per project.
export const channelAudienceEnum = pgEnum("channel_audience", [
  "workspace",
  "members",
])

// A text channel is a chat (reference/agents-and-chats.md, decision 31): a
// named group of people and agents, listed by its last message. "channel" is
// kept for long-lived channels, should they come back; nothing makes one yet.
// "place" is a Slack or Discord channel an agent is in (decisions 24 and 51):
// the row holds what was said there, for the agents' inboxes, history, Loops
// and sessions, and no list in Lor shows it. Which outside channel it is:
// `channel_discord_link`.
export const channelKindEnum = pgEnum("channel_kind", [
  "chat",
  "channel",
  "place",
])

export const channel = pgTable(
  "channel",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    name: text("name"),
    topic: text("topic"),
    type: channelTypeEnum("type").notNull().default("text"),
    audience: channelAudienceEnum("audience").notNull().default("workspace"),
    kind: channelKindEnum("kind").notNull().default("chat"),

    // Archived channels are read-only and leave the active sidebar; set on
    // all of a project's channels when it archives.
    archivedAt: timestamp("archived_at"),

    // null for DMs/group DMs
    workspaceId: uuid("workspace_id").references(() => workspace.id, {
      onDelete: "cascade",
    }),

    // points to a category channel
    parentId: uuid("parent_id").references((): AnyPgColumn => channel.id, {
      onDelete: "set null",
    }),

    // Tools are the agent's, not the channel's (agent.agent_profile_id).

    // Which agents are in a channel is `channel_agent` (schemas/agents.ts).

    // ordering within a category or workspace
    position: integer("position").default(0).notNull(),

    // group DM owner — null for workspace channels (use roles/permissions instead)
    ownerId: uuid("owner_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // Who made a workspace channel. The creator may rename it and change its
    // topic without channel:update. Null for seeded and older channels.
    creatorId: uuid("creator_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // null = no slowmode
    rateLimitPerUser: integer("rate_limit_per_user"),
  },
  (table) => [
    index("channel_workspaceId_idx").on(table.workspaceId),
    index("channel_parentId_idx").on(table.parentId),
  ]
)

export const channelRelations = relations(channel, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [channel.workspaceId],
    references: [workspace.id],
  }),
  parent: one(channel, {
    fields: [channel.parentId],
    references: [channel.id],
    relationName: "channelParent",
  }),
  children: many(channel, {
    relationName: "channelParent",
  }),
  owner: one(user, {
    fields: [channel.ownerId],
    references: [user.id],
  }),
  messages: many(message),
  members: many(channelMember),
}))

// The people in a channel, one list for every kind
// (reference/agents-and-chats.md, decisions 35 and 36):
// - a DM or group DM: its people, which is also who can open it;
// - a chat (text channel): who is in it, so it is in their list. Chats are
//   open and hidden: anyone who can see one finds it and joins;
// - a private chat or project (audience "members"): the rows on the access
//   container (the parent category, else the channel) are also who can see
//   it (queries/channel-access.ts). A chat inside a project has its own
//   rows for who is in that chat.
export const channelMember = pgTable(
  "channel_member",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // This person's own, for a chat. Pinned chats lead their list, in the
    // order they were pinned.
    pinnedAt: timestamp("pinned_at"),
    // Put away by this person. A message after this time brings it back.
    hiddenAt: timestamp("hidden_at"),
  },
  (table) => [
    uniqueIndex("channelMember_channel_user_uidx").on(
      table.channelId,
      table.userId
    ),
    index("channelMember_userId_idx").on(table.userId),
  ]
)

export const channelMemberRelations = relations(channelMember, ({ one }) => ({
  channel: one(channel, {
    fields: [channelMember.channelId],
    references: [channel.id],
  }),
  user: one(user, {
    fields: [channelMember.userId],
    references: [user.id],
  }),
}))

// Zod schemas
export const selectChannelSchema = createSelectSchema(channel)

export const insertChannelSchema = createInsertSchema(channel, {
  name: (s) => s.min(1).max(100),
  topic: (s) => s.max(1024).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  workspaceId: true,
  ownerId: true,
  creatorId: true,
  position: true,
  rateLimitPerUser: true,
  // Audience/archival are set through the project + private-channel routes
  // (with membership handling), never raw channel create/update.
  audience: true,
  archivedAt: true,
  kind: true,
})

export const updateChannelSchema = createUpdateSchema(channel, {
  name: (s) => s.min(1).max(100),
  topic: (s) => s.max(1024),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  workspaceId: true,
  ownerId: true,
  creatorId: true,
  audience: true,
  archivedAt: true,
  kind: true,
})
