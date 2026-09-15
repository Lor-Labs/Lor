import { and, db, eq, inArray, schema } from "@repo/db"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import type { ChannelActivity } from "@repo/realtime-types"

// Per-channel Lor state for the sidebar, aggregated across every thread in
// the channel and filtered to what the requesting user can access. Precedence:
// working/finalizing > queued > needs_approval > needs_input.
export async function getWorkspaceActivity(
  userId: string,
  workspaceId: string
): Promise<ChannelActivity[]> {
  const membership = await db.query.workspaceMember.findFirst({
    where: and(
      eq(schema.workspaceMember.workspaceId, workspaceId),
      eq(schema.workspaceMember.userId, userId)
    ),
    columns: { id: true },
  })
  if (!membership) throw new Error("Workspace not found")

  const accessible = await listAccessibleChannelIds(userId, workspaceId)
  if (accessible.size === 0) return []
  const channelIds = [...accessible]
  const [runs, plans] = await Promise.all([
    db
      .select({
        channelId: schema.agentRun.channelId,
        state: schema.agentRun.state,
      })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.workspaceId, workspaceId),
          inArray(schema.agentRun.channelId, channelIds),
          inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
        )
      ),
    db
      .select({ channelId: schema.plan.channelId, status: schema.plan.status })
      .from(schema.plan)
      .where(
        and(
          eq(schema.plan.workspaceId, workspaceId),
          inArray(schema.plan.channelId, channelIds),
          inArray(schema.plan.status, [
            "waiting_for_input",
            "waiting_for_approval",
          ])
        )
      ),
  ])

  const channels = new Map<string, ChannelActivity>()
  const getChannel = (channelId: string) => {
    let activity = channels.get(channelId)
    if (!activity) {
      activity = { channelId, lor: null }
      channels.set(channelId, activity)
    }
    return activity
  }
  for (const run of runs) {
    const activity = getChannel(run.channelId)
    if (activity.lor !== "working") {
      activity.lor = run.state === "queued" ? "queued" : "working"
    }
  }
  for (const plan of plans) {
    const activity = getChannel(plan.channelId)
    // Active work takes precedence when other threads in the channel are waiting.
    if (activity.lor === "working" || activity.lor === "queued") continue
    if (activity.lor !== "needs_approval") {
      activity.lor =
        plan.status === "waiting_for_approval"
          ? "needs_approval"
          : "needs_input"
    }
  }
  return [...channels.values()].sort((a, b) =>
    a.channelId.localeCompare(b.channelId)
  )
}
