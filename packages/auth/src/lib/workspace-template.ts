import { db, LOR_USER_ID, schema } from "@repo/db"

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

const LOR_INTRO =
  "Hi, I'm Lor. Mention me with @Lor in any channel to ask about your code, your issues, or anything this team has discussed. I show my work and cite what I used."

// Inserted directly, without fanout: at creation the only human member is
// the creator, who lands in #general. Later joiners see it as unread there.
export async function seedWorkspaceTemplate(workspaceId: string) {
  await db.transaction(async (tx) => {
    const channels = await tx
      .insert(schema.channel)
      .values(
        STARTUP_CHANNELS.map((channel, position) => ({
          ...channel,
          workspaceId,
          position,
        }))
      )
      .returning({ id: schema.channel.id, name: schema.channel.name })

    const general = channels.find((channel) => channel.name === "general")
    if (!general) return

    await tx.insert(schema.message).values({
      channelId: general.id,
      authorId: LOR_USER_ID,
      content: LOR_INTRO,
      excludedFromMemory: true,
    })
  })
}
