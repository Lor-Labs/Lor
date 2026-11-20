import { and, db, desc, eq, inArray, isNotNull, isNull, schema } from "@repo/db"
import type { Loop } from "@repo/db/schema"
import { logger } from "./logger"
import { nextLoopRunAt } from "./loop-schedule"

// The check-in every text channel's agent comes with
// (reference/always-on-agents.md, decision 7): a Loop every 30 minutes in
// active hours that wakes the agent only when something waits unread. People
// change its hours or turn it off like any Loop.

export const CHECK_IN_NAME = "Check-in"
// Every 30 minutes from 9:00 to 18:00 on weekdays.
export const CHECK_IN_SCHEDULE = "*/30 9-17 * * 1-5"
export const CHECK_IN_INSTRUCTIONS =
  "Look over what came in since you last looked: messages that weren't addressed to you and events that waited. Act or answer only where something needs you or the team would want you to step in; otherwise end the turn quietly."

// Active hours in the team's time: the zone a person pinned on the
// workspace's latest Loop, else UTC (nothing stores a workspace's zone).
async function workspaceTimezone(workspaceId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: schema.loop.timezone })
    .from(schema.loop)
    .where(
      and(
        eq(schema.loop.workspaceId, workspaceId),
        eq(schema.loop.kind, "custom"),
        isNotNull(schema.loop.timezone),
        inArray(schema.loop.status, ["active", "paused", "completed"])
      )
    )
    .orderBy(desc(schema.loop.updatedAt))
    .limit(1)
  return row?.timezone ?? "UTC"
}

// Made once per channel: the channel's marker is set in the same
// transaction, so a check-in someone deleted is not made again. The new Loop
// when it was made now, else null.
export async function ensureCheckInLoop(
  channelId: string
): Promise<Loop | null> {
  const [channel] = await db
    .select({
      workspaceId: schema.channel.workspaceId,
      type: schema.channel.type,
      archivedAt: schema.channel.archivedAt,
      checkInAt: schema.channel.agentCheckInAt,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
  if (
    !channel?.workspaceId ||
    channel.type !== "text" ||
    channel.archivedAt ||
    channel.checkInAt
  ) {
    return null
  }
  const workspaceId = channel.workspaceId
  const timezone = await workspaceTimezone(workspaceId)
  const made = await db.transaction(async (tx) => {
    const marked = await tx
      .update(schema.channel)
      .set({ agentCheckInAt: new Date() })
      .where(
        and(
          eq(schema.channel.id, channelId),
          isNull(schema.channel.agentCheckInAt)
        )
      )
      .returning({ id: schema.channel.id })
    if (marked.length === 0) return null
    const [loop] = await tx
      .insert(schema.loop)
      .values({
        workspaceId,
        channelId,
        kind: "check_in",
        name: CHECK_IN_NAME,
        instructions: CHECK_IN_INSTRUCTIONS,
        schedule: CHECK_IN_SCHEDULE,
        timezone,
        status: "active",
        nextRunAt: nextLoopRunAt(CHECK_IN_SCHEDULE, timezone),
      })
      .returning()
    return loop ?? null
  })
  if (made) logger.info({ channelId, timezone }, "Channel check-in Loop made")
  return made
}

// What the agent reads at a check-in. The unread items themselves come
// first, under "Since you last looked".
export function checkInInboxNote(instructions: string): string {
  return `Your regular check-in. ${instructions.trim() || CHECK_IN_INSTRUCTIONS} Nobody asked just now: when you do speak, speak as if you noticed it yourself.`
}
