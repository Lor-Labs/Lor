import { and, db, eq, schema } from "@repo/db"

const DM_CHANNEL_TYPES = ["dm", "group_dm"] as const

// User can access a workspace channel via workspace membership, or a DM /
// group DM via channel membership. Mirrors the presign handler's check.
export async function userCanAccessChannel(channelId: string, userId: string) {
  const ch = await db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      type: schema.channel.type,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
    .limit(1)
    .then((rows) => rows[0])

  if (!ch) return false

  if (ch.workspaceId) {
    const member = await db
      .select({ id: schema.workspaceMember.id })
      .from(schema.workspaceMember)
      .where(
        and(
          eq(schema.workspaceMember.workspaceId, ch.workspaceId),
          eq(schema.workspaceMember.userId, userId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    return Boolean(member)
  }

  if (
    !DM_CHANNEL_TYPES.includes(ch.type as (typeof DM_CHANNEL_TYPES)[number])
  ) {
    return false
  }

  const member = await db
    .select({ id: schema.channelMember.id })
    .from(schema.channelMember)
    .where(
      and(
        eq(schema.channelMember.channelId, channelId),
        eq(schema.channelMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  return Boolean(member)
}
