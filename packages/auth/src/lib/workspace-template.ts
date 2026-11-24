import { db, schema } from "@repo/db"
import { createAgent } from "@repo/db/queries/agents"
import { isChannelFeatureEnabled } from "@repo/utils/features"

type TemplateChannel = Pick<
  typeof schema.channel.$inferSelect,
  "name" | "type" | "topic"
>

// Startup default channels (reference/onboarding.md, "Default workspace
// template"). Topics are read by Lor as channel context.
const STARTUP_CHANNELS: TemplateChannel[] = [
  { name: "general", type: "text", topic: "Team-wide updates and discussion." },
  {
    name: "engineering",
    type: "text",
    topic: "Code, pull requests, and technical decisions.",
  },
  {
    name: "product",
    type: "text",
    topic: "Specs, roadmap, and what to build next.",
  },
  {
    name: "design",
    type: "text",
    topic: "Mockups, UI feedback, and design decisions.",
  },
  {
    name: "customers",
    type: "text",
    topic: "Customer feedback, requests, and calls.",
  },
  { name: "random", type: "text", topic: "Everything else." },
  { name: "standup", type: "voice", topic: "Daily sync. Lor takes notes." },
]

// No Lor intro post: Lor never writes in channel chat
// (reference/workspace-model.md); the New session view teaches what it does.
// A new workspace starts with one agent, in every text channel: a team adds
// more, or takes it out of a channel, when it wants to
// (reference/agents-and-chats.md).
export async function seedWorkspaceTemplate(workspaceId: string) {
  await db.transaction(async (tx) => {
    const agent = await createAgent({ workspaceId }, tx)
    await tx.insert(schema.channel).values(
      STARTUP_CHANNELS.filter(isChannelFeatureEnabled).map(
        (channel, position) => ({
          ...channel,
          agentId: channel.type === "text" ? agent.id : null,
          workspaceId,
          position,
        })
      )
    )
  })
}
