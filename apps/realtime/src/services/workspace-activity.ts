import {
  approvalResolverSpecFor,
  canResolveApproval,
} from "@repo/auth/permissions"
import {
  and,
  db,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  LOR_USER_ID,
  schema,
  sql,
} from "@repo/db"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import {
  type AgentNeed,
  type ChannelActivity,
  type SidebarSessionState,
  uncommittedLinesOf,
} from "@repo/realtime-types"

// Bounds the sidebar payload; older sessions stay reachable from the
// channel's session list and search.
const SESSION_LIMIT = 200
// The channel agent's questions count for a week, unanswered.
const QUESTION_DAYS = 7
const QUESTION_LIMIT = 20
const NEED_TEXT_CHARS = 160

function clipNeedText(text: string | null): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim()
  return flat.length > NEED_TEXT_CHARS
    ? `${flat.slice(0, NEED_TEXT_CHARS)}…`
    : flat
}

// The sidebar's session rows: the user's subscribed sessions in channels they
// can access, grouped by channel, each with its own state.
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

  // Unread: a message from someone else, or a run that finished, after the
  // user's read cursor. finished_at, not updated_at: write-back and usage
  // keep writing the run row after a reply the user already read. With no
  // cursor only the last week counts, so backfilled sessions don't all start
  // unread.
  const readCursor = sql`coalesce(${schema.threadReadState.lastReadAt}, now() - interval '7 days')`
  const lastActivityAt =
    sql<Date>`greatest(${schema.agentSession.createdAt}, (select max(m.created_at) from message m where m.thread_root_id = ${schema.agentSession.threadRootId}))`.mapWith(
      schema.agentSession.createdAt
    )

  const [runs, plans, approvals, sessions, questions] = await Promise.all([
    db
      .select({
        threadRootId: schema.agentRun.threadRootId,
        channelId: schema.agentRun.channelId,
        scopeKey: schema.agentRun.scopeKey,
        // Set when the run's thread is an unarchived session.
        sessionId: schema.agentSession.id,
      })
      .from(schema.agentRun)
      .leftJoin(
        schema.agentSession,
        and(
          eq(schema.agentSession.threadRootId, schema.agentRun.threadRootId),
          isNull(schema.agentSession.archivedAt)
        )
      )
      .where(
        and(
          eq(schema.agentRun.workspaceId, workspaceId),
          inArray(schema.agentRun.channelId, channelIds),
          inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
        )
      ),
    // A plan waiting for approval always has its approval row, so the
    // approvals below decide that case.
    db
      .select({ threadRootId: schema.plan.threadRootId })
      .from(schema.plan)
      .where(
        and(
          eq(schema.plan.workspaceId, workspaceId),
          inArray(schema.plan.channelId, channelIds),
          eq(schema.plan.status, "waiting_for_input")
        )
      ),
    // Pending approvals directly: a policy-parked approval on a plan-less run
    // has no waiting plan. The approval row has no thread; resolve it through
    // the plan or run it anchors to.
    db
      .select({
        planThreadRootId: schema.plan.threadRootId,
        runThreadRootId: schema.agentRun.threadRootId,
        runScopeKey: schema.agentRun.scopeKey,
        runChannelId: schema.agentRun.channelId,
        runMessageId: schema.agentRun.messageId,
        description: schema.approval.description,
        createdAt: schema.approval.createdAt,
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
        mode: schema.agentSession.mode,
        uncommittedAdditions: schema.agentSession.uncommittedAdditions,
        uncommittedDeletions: schema.agentSession.uncommittedDeletions,
        lastActivityAt,
        unread: sql<boolean>`(exists (select 1 from message m where m.thread_root_id = ${schema.agentSession.threadRootId} and m.author_id <> ${userId}::uuid and m.created_at > ${readCursor}) or exists (select 1 from agent_run r where r.thread_root_id = ${schema.agentSession.threadRootId} and r.finished_at > ${readCursor}))`,
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
    // The channel agent's posts that mention the user, with nothing from
    // the user in that place since (the chat, or the thread it is in or
    // started).
    db
      .select({
        id: schema.message.id,
        channelId: schema.message.channelId,
        threadRootId: schema.message.threadRootId,
        content: schema.message.content,
        createdAt: schema.message.createdAt,
      })
      .from(schema.message)
      .where(
        and(
          inArray(schema.message.channelId, channelIds),
          eq(schema.message.type, "agent_post"),
          eq(schema.message.authorId, LOR_USER_ID),
          gt(
            schema.message.createdAt,
            sql`now() - make_interval(days => ${QUESTION_DAYS})`
          ),
          sql`${schema.message.content} like ${`%<@${userId}>%`}`,
          sql`not exists (select 1 from message r where r.channel_id = ${schema.message.channelId} and r.author_id = ${userId}::uuid and r.created_at > ${schema.message.createdAt} and (r.thread_root_id is not distinct from ${schema.message.threadRootId} or r.thread_root_id = ${schema.message.id}))`
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(QUESTION_LIMIT),
  ])

  // Session state is keyed by the session's thread root.
  const running = new Set<string>()
  const needsYou = new Set<string>()
  // Per channel: the agent's own turn (its run holds the channel, with no
  // thread), and every session with a run in progress.
  const agentWorking = new Set<string>()
  const runningSessions = new Map<string, Set<string>>()
  for (const run of runs) {
    if (run.threadRootId) running.add(run.threadRootId)
    if (!run.channelId) continue
    if (!run.threadRootId && run.scopeKey === run.channelId) {
      agentWorking.add(run.channelId)
    }
    if (run.sessionId) {
      const ids = runningSessions.get(run.channelId) ?? new Set()
      ids.add(run.sessionId)
      runningSessions.set(run.channelId, ids)
    }
  }
  const agentApprovals: { channelId: string; need: AgentNeed }[] = []
  // "Needs you": a question from Lor needs anyone in the session; an
  // approval needs only the people allowed to resolve it.
  for (const plan of plans) {
    if (plan.threadRootId) needsYou.add(plan.threadRootId)
  }
  for (const approval of approvals) {
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
    // A channel agent's turn: its run holds the channel, with no thread.
    const agentTurn =
      !threadRootId &&
      approval.runChannelId !== null &&
      approval.runScopeKey === approval.runChannelId
    if (
      agentTurn &&
      canResolve &&
      approval.runMessageId &&
      approval.runChannelId &&
      accessible.has(approval.runChannelId)
    ) {
      agentApprovals.push({
        channelId: approval.runChannelId,
        need: {
          kind: "approval",
          messageId: approval.runMessageId,
          threadRootId: null,
          text: clipNeedText(approval.description),
          createdAt: approval.createdAt.toISOString(),
        },
      })
    }
  }
  const channels = new Map<string, ChannelActivity>()
  const activityOf = (channelId: string) => {
    let activity = channels.get(channelId)
    if (!activity) {
      activity = {
        channelId,
        sessions: [],
        agentNeeds: [],
        agentWorking: agentWorking.has(channelId),
        runningSessions: runningSessions.get(channelId)?.size ?? 0,
      }
      channels.set(channelId, activity)
    }
    return activity
  }
  // A channel with nothing of the caller's still shows its agent at work.
  for (const channelId of agentWorking) activityOf(channelId)
  for (const channelId of runningSessions.keys()) activityOf(channelId)
  for (const question of questions) {
    if (!accessible.has(question.channelId)) continue
    activityOf(question.channelId).agentNeeds.push({
      kind: "question",
      messageId: question.id,
      threadRootId: question.threadRootId,
      text: clipNeedText(question.content),
      createdAt: question.createdAt.toISOString(),
    })
  }
  for (const session of sessions) {
    const activity = activityOf(session.channelId)
    const state: SidebarSessionState = needsYou.has(session.threadRootId)
      ? "needs_you"
      : running.has(session.threadRootId)
        ? "running"
        : session.unread
          ? "unread"
          : "idle"
    activity.sessions.push({
      id: session.id,
      threadRootId: session.threadRootId,
      title: session.title,
      titleEdited: session.titleEditedAt !== null,
      state,
      loop: session.loopId !== null,
      code: session.mode === "code",
      uncommitted: uncommittedLinesOf(session),
      lastActivityAt: session.lastActivityAt.toISOString(),
    })
  }
  for (const { channelId, need } of agentApprovals) {
    activityOf(channelId).agentNeeds.push(need)
  }
  // Newest first. ISO timestamps sort as strings.
  for (const activity of channels.values()) {
    activity.agentNeeds.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  return [...channels.values()].sort((a, b) =>
    a.channelId.localeCompare(b.channelId)
  )
}
