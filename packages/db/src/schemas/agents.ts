import { relations } from "drizzle-orm"
import {
  type AnyPgColumn,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { createSelectSchema } from "drizzle-zod"
import { channel } from "./channels"
import { user } from "./users"
import { workspace } from "./workspaces"

// An always-on agent: a teammate for one role, with its own name, face,
// brief, model and memory, added to channels (reference/agents-and-chats.md).
// A channel points at its agent (`channel.agent_id`) or has none; one agent
// can be in several channels.
export const agent = pgTable(
  "agent",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // A creature id from @repo/utils/bestiary: the face it is drawn with.
    creature: text("creature").notNull(),
    identityUpdatedAt: timestamp("identity_updated_at"),
    // What it looks after, in a few words ("Eng"): shown beside its name.
    role: text("role"),
    // Standing instructions only people write, in its system prompt.
    brief: text("brief"),
    briefUpdatedAt: timestamp("brief_updated_at"),
    // The model for its own turns, as Lor's harness names it. Null = the
    // default.
    model: text("model"),
    // Who can see the agent, its facts and what it hears. Null = the whole
    // workspace. Otherwise the access container (a members-only channel or
    // category) whose members can, and the only place it can be added: an
    // agent carries what it hears, so it never spans audiences.
    accessContainerId: uuid("access_container_id").references(
      (): AnyPgColumn => channel.id,
      { onDelete: "cascade" }
    ),
    createdById: uuid("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("agent_workspaceId_idx").on(table.workspaceId)]
)

export const agentRelations = relations(agent, ({ one }) => ({
  workspace: one(workspace, {
    fields: [agent.workspaceId],
    references: [workspace.id],
  }),
}))

export type Agent = typeof agent.$inferSelect

export const selectAgentSchema = createSelectSchema(agent)
