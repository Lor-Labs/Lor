import { db, schema } from "@repo/db"

type TemplateChannel = Pick<
  typeof schema.channel.$inferInsert,
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
  { name: "standup", type: "voice", topic: "Daily sync. Lor takes notes." },
  { name: "random", type: "text", topic: "Everything else." },
]

// No Lor intro post: Lor never writes in channel chat
// (reference/workspace-model.md); the New session view teaches what it does.
export async function seedWorkspaceTemplate(workspaceId: string) {
  await db.insert(schema.channel).values(
    STARTUP_CHANNELS.map((channel, position) => ({
      ...channel,
      workspaceId,
      position,
    }))
  )
}
