import { db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import {
  agentFaceUrl,
  discordConfigured,
  discordLinkFor,
  postAgentToDiscord,
} from "./discord"
import { agentCardIdentity, loopCard } from "./discord-ui"

// Loops in Discord places (reference/agents-and-chats.md, decision 51):
// people there see a Loop's card when an agent sets one up, and a line when
// it changes, pauses or ends, as people in a Lor chat see its card and lines.

// The Loop's card, posted by its agent in a place: in the thread the request
// was in, else in the channel. Nothing when the chat isn't a place.
export async function postLoopCardToDiscord(input: {
  loopId: string
  channelId: string
  threadRootId?: string | null
}) {
  if (!discordConfigured()) return
  if (!(await discordLinkFor(input.channelId))) return
  const [loop] = await db
    .select({
      id: schema.loop.id,
      name: schema.loop.name,
      agentId: schema.loop.agentId,
      schedule: schema.loop.schedule,
      timezone: schema.loop.timezone,
      nextRunAt: schema.loop.nextRunAt,
      reportsIn: schema.loop.channelId,
      slug: schema.workspace.slug,
    })
    .from(schema.loop)
    .innerJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.loop.workspaceId)
    )
    .where(eq(schema.loop.id, input.loopId))
  if (!loop?.agentId) return
  const [reportsIn] = loop.reportsIn
    ? await db
        .select({
          name: schema.channel.name,
          kind: schema.channel.kind,
        })
        .from(schema.channel)
        .where(eq(schema.channel.id, loop.reportsIn))
    : []
  const identity = await agentCardIdentity(loop.agentId)
  await postAgentToDiscord({
    channelId: input.channelId,
    agentId: loop.agentId,
    messageId: null,
    content: "",
    components: loopCard({
      name: loop.name,
      when: describeLoopSchedule(loop.schedule, loop.timezone),
      reportsIn:
        loop.reportsIn === input.channelId
          ? "this channel"
          : reportsIn
            ? reportsIn.kind === "place"
              ? `#${reportsIn.name ?? "channel"} in Discord`
              : `${reportsIn.name ?? "a chat"} in Lor`
            : null,
      nextRun: loop.nextRunAt
        ? new Intl.DateTimeFormat("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: loop.timezone ?? "UTC",
            timeZoneName: "short",
          }).format(loop.nextRunAt)
        : null,
      accent: identity?.accent ?? 0x5865f2,
      face: await agentFaceUrl(input.channelId, loop.agentId).catch(() => null),
      lorUrl: `${env.APP_BASE_URL}/${loop.slug}/${loop.reportsIn ?? input.channelId}?loop=${loop.id}`,
    }),
    threadRootId: input.threadRootId ?? null,
  })
}

// A line about a Loop (changed, paused, completed) where it reports, when
// that is a place, posted by the Loop's agent.
export async function postLoopLineToDiscord(input: {
  loopId: string
  channelId: string
  text: string
}) {
  if (!discordConfigured()) return
  if (!(await discordLinkFor(input.channelId))) return
  const [loop] = await db
    .select({ agentId: schema.loop.agentId })
    .from(schema.loop)
    .where(eq(schema.loop.id, input.loopId))
  if (!loop?.agentId) return
  await postAgentToDiscord({
    channelId: input.channelId,
    agentId: loop.agentId,
    messageId: null,
    content: `-# ${input.text}`,
  })
}
