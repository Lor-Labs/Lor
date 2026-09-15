import { and, db, eq, inArray, schema } from "@repo/db"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import type { ChannelActivity } from "@repo/realtime-types"

// Per-channel Lor state for the sidebar, aggregated across every thread in
// the channel and filtered to what the requesting user can access. Precedence:
// needs_approval > working/finalizing > queued > needs_input — an approval
// gate outranks active work; it's the state that needs a human and a
// concurrent run in another thread must not mask it.
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
  const [runs, plans, approvals] = await Promise.all([
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
    // Pending approvals directly: a policy-parked approval on a plan-less run
    // has no waiting plan and its run has already ended its turn, so neither
    // query above sees it. The approval row has no channel — resolve it
    // through the plan or run it anchors to.
    db
      .select({
        planChannelId: schema.plan.channelId,
        runChannelId: schema.agentRun.channelId,
      })
      .from(schema.approval)
      .leftJoin(schema.plan, eq(schema.approval.planId, schema.plan.id))
      .leftJoin(schema.agentRun, eq(schema.approval.runId, schema.agentRun.id))
      .where(
        and(
          eq(schema.approval.workspaceId, workspaceId),
          eq(schema.approval.status, "pending")
        )
      ),
  ])

  const rank = {
    needs_input: 1,
    queued: 2,
    working: 3,
    needs_approval: 4,
  } as const
  const channels = new Map<string, ChannelActivity>()
  const bump = (channelId: string, state: keyof typeof rank) => {
    const activity = channels.get(channelId)
    if (!activity) {
      channels.set(channelId, { channelId, lor: state })
      return
    }
    if (!activity.lor || rank[state] > rank[activity.lor]) {
      activity.lor = state
    }
  }
  for (const run of runs) {
    bump(run.channelId, run.state === "queued" ? "queued" : "working")
  }
  for (const plan of plans) {
    bump(
      plan.channelId,
      plan.status === "waiting_for_approval" ? "needs_approval" : "needs_input"
    )
  }
  for (const approval of approvals) {
    const channelId = approval.planChannelId ?? approval.runChannelId
    if (channelId && accessible.has(channelId)) {
      bump(channelId, "needs_approval")
    }
  }
  return [...channels.values()].sort((a, b) =>
    a.channelId.localeCompare(b.channelId)
  )
}
