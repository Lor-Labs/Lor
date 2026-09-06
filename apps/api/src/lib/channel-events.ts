import { db, schema } from "@repo/db"
import type {
  ChannelCreatedPayload,
  ChannelRenamedPayload,
  LoopEventPayload,
  MemberAddedPayload,
  MemberRemovedPayload,
} from "@repo/db/schema"
import { channelEventContent } from "@repo/messaging"
import { eq, inArray } from "drizzle-orm"
import { postBotMessage } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

// Discriminated so each emitter passes exactly the payload its kind needs.
type ChannelEventInput =
  | { eventType: "channel_created"; payload?: ChannelCreatedPayload }
  | { eventType: "channel_renamed"; payload: ChannelRenamedPayload }
  | { eventType: "member_added"; payload: MemberAddedPayload }
  | { eventType: "member_removed"; payload: MemberRemovedPayload }
  | { eventType: "member_left" }
  | {
      eventType: "loop_created" | "loop_paused" | "loop_completed"
      payload: LoopEventPayload
    }

type PostChannelEventInput = ChannelEventInput & {
  channel: {
    id: string
    workspaceId: string | null
    name: string | null
    workspaceName?: string | null
  }
  // The acting user (or MERLIN_USER_ID) — becomes the message author.
  actorId: string
}

// Post a channel event into the feed. Best effort — an event must never fail
// the action that caused it. Silent (no unread/push fanout) except
// channel_created, which uses normal fanout so the new channel lights up
// unread for teammates.
export async function postChannelEvent(
  input: PostChannelEventInput
): Promise<void> {
  try {
    const content = await buildEventContent(input)
    await postBotMessage({
      channel: input.channel,
      authorId: input.actorId,
      content,
      type: "event",
      eventType: input.eventType,
      eventPayload: "payload" in input ? (input.payload ?? null) : null,
      silent: input.eventType !== "channel_created",
      excludedFromMemory: true,
    })
  } catch (err) {
    logger.error(
      { err, channelId: input.channel.id, eventType: input.eventType },
      "Channel event post failed"
    )
  }
}

// Loop lifecycle events resolve the loop's channel themselves — callers hold
// only the loop row. Best effort like postChannelEvent: a lookup failure must
// not fail the loop transition that already committed.
export async function postLoopChannelEvent(input: {
  loop: { id: string; name: string; channelId: string }
  actorId: string
  eventType: "loop_created" | "loop_paused" | "loop_completed"
  reason?: "failures" | "out_of_credits"
}): Promise<void> {
  try {
    const channel = await db
      .select({
        id: schema.channel.id,
        workspaceId: schema.channel.workspaceId,
        name: schema.channel.name,
      })
      .from(schema.channel)
      .where(eq(schema.channel.id, input.loop.channelId))
      .limit(1)
      .then((rows) => rows[0])
    if (!channel) return
    await postChannelEvent({
      channel,
      actorId: input.actorId,
      eventType: input.eventType,
      payload: {
        loopId: input.loop.id,
        loopName: input.loop.name,
        reason: input.reason,
      },
    })
  } catch (err) {
    logger.error(
      { err, loopId: input.loop.id, eventType: input.eventType },
      "Loop channel event failed"
    )
  }
}

async function buildEventContent(
  input: PostChannelEventInput
): Promise<string> {
  const memberIds =
    input.eventType === "member_added"
      ? input.payload.userIds
      : input.eventType === "member_removed"
        ? [input.payload.userId]
        : []
  const nameRows = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(inArray(schema.user.id, [input.actorId, ...memberIds]))
  const nameById = new Map(nameRows.map((row) => [row.id, row.name]))
  const actorName = nameById.get(input.actorId) ?? "Someone"

  switch (input.eventType) {
    case "channel_created":
      return channelEventContent({
        eventType: input.eventType,
        actorName,
        viaProposal: input.payload?.via === "proposal",
        originChannelName: input.payload?.originChannelName,
      })
    case "channel_renamed":
      return channelEventContent({
        eventType: input.eventType,
        actorName,
        from: input.payload.from,
        to: input.payload.to,
      })
    case "member_added":
      return channelEventContent({
        eventType: input.eventType,
        actorName,
        memberNames: memberIds.map((id) => nameById.get(id) ?? "a teammate"),
      })
    case "member_removed":
      return channelEventContent({
        eventType: input.eventType,
        actorName,
        memberName: nameById.get(input.payload.userId) ?? "a teammate",
      })
    case "member_left":
      return channelEventContent({ eventType: input.eventType, actorName })
    case "loop_created":
      return channelEventContent({
        eventType: input.eventType,
        actorName,
        loopName: input.payload.loopName,
        viaProposal: input.payload.via === "proposal",
      })
    case "loop_paused":
      return channelEventContent({
        eventType: input.eventType,
        loopName: input.payload.loopName,
        reason: input.payload.reason ?? "failures",
      })
    case "loop_completed":
      return channelEventContent({
        eventType: input.eventType,
        actorName,
        loopName: input.payload.loopName,
      })
  }
}
