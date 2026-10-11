import {
  approvalResolverSpecFor,
  canResolveApproval,
} from "@repo/auth/permissions"
import { and, db, desc, eq, inArray, isNull, schema, sql } from "@repo/db"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import type { ChannelActivity, SidebarSessionState } from "@repo/realtime-types"

// Bounds the sidebar payload; older sessions stay reachable from the
// channel's session list and search.
const SESSION_LIMIT = 200

// Per-channel Lor state for the sidebar, aggregated across every thread in
// the channel and filtered to what the requesting user can access, plus the
// user's subscribed sessions with their own state. Precedence:
// needs_approval > working/finalizing > queued > needs_input — an approval
// gate outranks active work; it's the state that needs a human and a
// concurrent run in another thread must not mask it.
export async function getWorkspaceActivity(
  userId: string,
  workspaceId: string
): Promise<ChannelActivity[]> {
  const membership = await db
    .select({
      role: schema.workspaceMember.role,
      ownerId: schema.workspace.ownerId,
    })
    .from(schema.workspaceMember)
    .innerJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.workspaceMember.workspaceId)
    )
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspaceId),
        eq(schema.workspaceMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!membership) throw new Error("Workspace not found")
  const authority = {
    role: membership.role,
    isOwner: membership.ownerId === userId,
  }

  const accessible = await listAccessibleChannelIds(userId, workspaceId)
  if (accessible.size === 0) return []
  const channelIds = [...accessible]

  // Unread: a message from someone else, or a run that changed (finished),
  // after the user's read cursor. With no cursor only the last week counts,
  // so backfilled sessions don't all start unread.
  const readCursor = sql`coalesce(${schema.threadReadState.lastReadAt}, now() - interval '7 days')`
  const lastActivityAt =
    sql<Date>`greatest(${schema.agentSession.createdAt}, (select max(m.created_at) from message m where m.thread_root_id = ${schema.agentSession.threadRootId}))`.mapWith(
      schema.agentSession.createdAt
    )

  const [runs, plans, approvals, sessions] = await Promise.all([
    db
      .select({
        channelId: schema.agentRun.channelId,
        threadRootId: schema.agentRun.threadRootId,
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
      .select({
        channelId: schema.plan.channelId,
        threadRootId: schema.plan.threadRootId,
        status: schema.plan.status,
      })
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
        planThreadRootId: schema.plan.threadRootId,
        runChannelId: schema.agentRun.channelId,
        runThreadRootId: schema.agentRun.threadRootId,
        target: schema.approval.target,
        resolverKind: schema.approvalPolicy.resolverKind,
        resolverRole: schema.approvalPolicy.resolverRole,
        resolverUserId: schema.approvalPolicy.resolverUserId,
      })
      .from(schema.approval)
      .leftJoin(schema.plan, eq(schema.approval.planId, schema.plan.id))
      .leftJoin(schema.agentRun, eq(schema.approval.runId, schema.agentRun.id))
      .leftJoin(
        schema.approvalPolicy,
        and(
          eq(schema.approvalPolicy.workspaceId, schema.approval.workspaceId),
          eq(schema.approvalPolicy.target, schema.approval.target)
        )
      )
      .where(
        and(
          eq(schema.approval.workspaceId, workspaceId),
          eq(schema.approval.status, "pending")
        )
      ),
    db
      .select({
        id: schema.agentSession.id,
        channelId: schema.agentSession.channelId,
        threadRootId: schema.agentSession.threadRootId,
        title: schema.agentSession.title,
        titleEditedAt: schema.agentSession.titleEditedAt,
        loopId: schema.agentSession.loopId,
        lastActivityAt,
        unread: sql<boolean>`(exists (select 1 from message m where m.thread_root_id = ${schema.agentSession.threadRootId} and m.author_id <> ${userId}::uuid and m.created_at > ${readCursor}) or exists (select 1 from agent_run r where r.thread_root_id = ${schema.agentSession.threadRootId} and r.updated_at > ${readCursor}))`,
      })
      .from(schema.agentSession)
      .innerJoin(
        schema.threadSubscription,
        and(
          eq(
            schema.threadSubscription.threadRootId,
            schema.agentSession.threadRootId
          ),
          eq(schema.threadSubscription.userId, userId)
        )
      )
      .leftJoin(
        schema.threadReadState,
        and(
          eq(
            schema.threadReadState.threadRootId,
            schema.agentSession.threadRootId
          ),
          eq(schema.threadReadState.userId, userId)
        )
      )
      .where(
        and(
          eq(schema.agentSession.workspaceId, workspaceId),
          inArray(schema.agentSession.channelId, channelIds),
          isNull(schema.agentSession.archivedAt)
        )
      )
      .orderBy(desc(lastActivityAt))
      .limit(SESSION_LIMIT),
  ])

  const rank = {
    needs_input: 1,
    queued: 2,
    working: 3,
    needs_approval: 4,
  } as const
  const channels = new Map<string, ChannelActivity>()
  const entry = (channelId: string) => {
    let activity = channels.get(channelId)
    if (!activity) {
      activity = { channelId, lor: null, sessions: [] }
      channels.set(channelId, activity)
    }
    return activity
  }
  const bump = (channelId: string, state: keyof typeof rank) => {
    const activity = entry(channelId)
    if (!activity.lor || rank[state] > rank[activity.lor]) {
      activity.lor = state
    }
  }
  // Session state is keyed by the session's thread root.
  const running = new Set<string>()
  const needsYou = new Set<string>()
  for (const run of runs) {
    bump(run.channelId, run.state === "queued" ? "queued" : "working")
    if (run.threadRootId) running.add(run.threadRootId)
  }
  // "Needs you": a question from Lor needs anyone in the session; an
  // approval needs only the people allowed to resolve it. A plan waiting for
  // approval always has its approval row, so the approval decides.
  for (const plan of plans) {
    bump(
      plan.channelId,
      plan.status === "waiting_for_approval" ? "needs_approval" : "needs_input"
    )
    if (plan.threadRootId && plan.status === "waiting_for_input") {
      needsYou.add(plan.threadRootId)
    }
  }
  for (const approval of approvals) {
    const channelId = approval.planChannelId ?? approval.runChannelId
    if (channelId && accessible.has(channelId)) {
      bump(channelId, "needs_approval")
    }
    const threadRootId = approval.planThreadRootId ?? approval.runThreadRootId
    const spec = approvalResolverSpecFor(
      approval.target,
      approval.resolverKind
        ? {
            resolverKind: approval.resolverKind,
            resolverRole: approval.resolverRole,
            resolverUserId: approval.resolverUserId,
          }
        : null
    )
    const canResolve = spec
      ? canResolveApproval(authority, spec, userId)
      : authority.isOwner
    if (threadRootId && canResolve) needsYou.add(threadRootId)
  }
  for (const session of sessions) {
    const state: SidebarSessionState = needsYou.has(session.threadRootId)
      ? "needs_you"
      : running.has(session.threadRootId)
        ? "running"
        : session.unread
          ? "unread"
          : "idle"
    entry(session.channelId).sessions.push({
      id: session.id,
      threadRootId: session.threadRootId,
      title: session.title,
      titleEdited: session.titleEditedAt !== null,
      state,
      loop: session.loopId !== null,
      lastActivityAt: session.lastActivityAt.toISOString(),
    })
  }
  return [...channels.values()].sort((a, b) =>
    a.channelId.localeCompare(b.channelId)
  )
}
