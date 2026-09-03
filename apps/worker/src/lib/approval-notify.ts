import {
  type ApprovalResolverSpec,
  formatWorkspaceRole,
  isWorkspaceRole,
} from "@repo/auth/permissions"
import { and, db, eq, MERLIN_USER_ID, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { sendApprovalPush } from "@repo/messaging"
import type {
  ApprovalNotification,
  ServerToClientEvents,
} from "@repo/realtime-types"
import { userRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import { Queue } from "bullmq"
import { logger } from "@/lib/logger"

// Approval fan-out (LOR-83). Who hears about a parked run, and when:
// - The person whose message triggered the run (R) hears immediately — as the
//   resolver when they can act, as a "waiting on X" notice when they can't.
// - When R can act, everyone else eligible is paged only by the delayed
//   escalation job, and only if the approval is still pending — the common
//   case (R approves their own gate in seconds) pages nobody else.
// - When R can't act (or there is no R — loops, triggered runs), the eligible
//   set is paged immediately: nobody present can unblock it.
// Each ping is one surface per person: socket event for connected clients (the
// web/desktop OS notification), mobile push for the offline complement.

export const APPROVAL_ESCALATION_DELAY_MS = 2 * 60 * 1000
export const NOTIFY_APPROVAL_JOB = "notify-approval-escalation"
// Same queue index.ts's maintenance worker consumes — imported there so the
// name can't drift.
export const MAINTENANCE_QUEUE = "maintenance"

export function parseRedisUrl(url: string) {
  const parsed = new URL(url)
  const dbIndex = Number.parseInt(parsed.pathname.slice(1), 10)
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    db: Number.isFinite(dbIndex) ? dbIndex : 0,
  }
}

let maintenanceQueue: Queue | null = null
function getMaintenanceQueue(): Queue {
  maintenanceQueue ??= new Queue(MAINTENANCE_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
  })
  return maintenanceQueue
}

// Page the rest of the eligible set in a couple minutes if nobody resolved it.
// The job re-checks the row, so it self-cancels — no revoke needed.
export async function scheduleApprovalEscalation(
  approvalId: string
): Promise<void> {
  await getMaintenanceQueue().add(
    NOTIFY_APPROVAL_JOB,
    { approvalId },
    {
      delay: APPROVAL_ESCALATION_DELAY_MS,
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: true,
    }
  )
}

type PresenceRedisClient = {
  smIsMember(key: string, members: string[]): Promise<Array<boolean | number>>
}

type NotifyDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: PresenceRedisClient
}

type ParkedApprovalRow = {
  approvalId: string
  workspaceId: string
  target: string | null
  description: string
  status: string
  runId: string | null
  channelId: string
  threadRootId: string | null
  messageId: string | null
  triggerMessageId: string | null
}

async function loadParkedApproval(
  approvalId: string
): Promise<ParkedApprovalRow | null> {
  const row = await db
    .select({
      approvalId: schema.approval.id,
      workspaceId: schema.approval.workspaceId,
      target: schema.approval.target,
      description: schema.approval.description,
      status: schema.approval.status,
      runId: schema.approval.runId,
      channelId: schema.agentRun.channelId,
      threadRootId: schema.agentRun.threadRootId,
      messageId: schema.agentRun.messageId,
      triggerMessageId: schema.agentRun.triggerMessageId,
    })
    .from(schema.approval)
    .innerJoin(schema.agentRun, eq(schema.approval.runId, schema.agentRun.id))
    .where(eq(schema.approval.id, approvalId))
    .limit(1)
    .then((rows) => rows[0])
  return row ?? null
}

// The policy row's resolver spec for this approval's target; null when the
// named resolver dangles (deleted role/user) — owner-only, matching the
// resolve endpoint. No policy row (gate turned off while parked) falls back
// to any_member, also matching the endpoint.
async function loadResolverSpec(
  workspaceId: string,
  target: string | null
): Promise<ApprovalResolverSpec | null> {
  if (!target) return { kind: "any_member" }
  const policy = await db
    .select({
      resolverKind: schema.approvalPolicy.resolverKind,
      resolverRole: schema.approvalPolicy.resolverRole,
      resolverUserId: schema.approvalPolicy.resolverUserId,
    })
    .from(schema.approvalPolicy)
    .where(
      and(
        eq(schema.approvalPolicy.workspaceId, workspaceId),
        eq(schema.approvalPolicy.target, target)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!policy) return { kind: "any_member" }
  switch (policy.resolverKind) {
    case "any_member":
      return { kind: "any_member" }
    case "role":
      return policy.resolverRole
        ? { kind: "role", role: policy.resolverRole }
        : null
    case "user":
      return policy.resolverUserId
        ? { kind: "user", userId: policy.resolverUserId }
        : null
  }
}

// Who the resolver spec names, plus plain words for the "waiting" flavor.
// Owner is the fallback whenever the set would otherwise be empty — a parked
// run must always have someone to hear about it.
async function resolverAudience(
  workspaceId: string,
  spec: ApprovalResolverSpec | null,
  requesterId: string | null
): Promise<{ userIds: string[]; label: string }> {
  const ownerId = await db
    .select({ ownerId: schema.workspace.ownerId })
    .from(schema.workspace)
    .where(eq(schema.workspace.id, workspaceId))
    .limit(1)
    .then((rows) => rows[0]?.ownerId ?? null)
  const ownerFallback = ownerId ? [ownerId] : []

  if (!spec) return { userIds: ownerFallback, label: "the workspace owner" }
  switch (spec.kind) {
    case "any_member":
      // Everyone in the channel can resolve; a broadcast page would be noise.
      // The requester is the one directed recipient; the in-channel card and
      // the run's own message cover the rest. Headless runs (loops, triggered)
      // have no requester — page the owner so the park is never silent.
      return {
        userIds: requesterId ? [requesterId] : ownerFallback,
        label: "anyone in the channel",
      }
    case "role": {
      const members = await db
        .select({ userId: schema.workspaceMember.userId })
        .from(schema.workspaceMember)
        .where(
          and(
            eq(schema.workspaceMember.workspaceId, workspaceId),
            eq(schema.workspaceMember.role, spec.role)
          )
        )
      const label = isWorkspaceRole(spec.role)
        ? `the ${formatWorkspaceRole(spec.role)} role`
        : `the ${spec.role} role`
      return {
        userIds:
          members.length > 0 ? members.map((m) => m.userId) : ownerFallback,
        label,
      }
    }
    case "user": {
      const member = await db
        .select({
          userId: schema.workspaceMember.userId,
          name: schema.user.name,
        })
        .from(schema.workspaceMember)
        .innerJoin(
          schema.user,
          eq(schema.workspaceMember.userId, schema.user.id)
        )
        .where(
          and(
            eq(schema.workspaceMember.workspaceId, workspaceId),
            eq(schema.workspaceMember.userId, spec.userId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])
      if (!member) {
        return { userIds: ownerFallback, label: "the workspace owner" }
      }
      return { userIds: [member.userId], label: member.name }
    }
  }
}

// The person whose message triggered the parked run; null for headless runs
// (loops, triggered runs) and Merlin-authored triggers.
async function requesterOf(row: ParkedApprovalRow): Promise<string | null> {
  if (!row.triggerMessageId) return null
  const authorId = await db
    .select({ authorId: schema.message.authorId })
    .from(schema.message)
    .where(eq(schema.message.id, row.triggerMessageId))
    .limit(1)
    .then((rows) => rows[0]?.authorId ?? null)
  return authorId && authorId !== MERLIN_USER_ID ? authorId : null
}

async function buildNotification(
  row: ParkedApprovalRow,
  flavor: ApprovalNotification["flavor"],
  resolverLabel: string
): Promise<ApprovalNotification> {
  const [workspace, channel] = await Promise.all([
    db
      .select({ name: schema.workspace.name })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, row.workspaceId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({ name: schema.channel.name })
      .from(schema.channel)
      .where(eq(schema.channel.id, row.channelId))
      .limit(1)
      .then((rows) => rows[0]),
  ])
  return {
    approvalId: row.approvalId,
    flavor,
    workspaceId: row.workspaceId,
    workspaceName: workspace?.name ?? "your workspace",
    channelId: row.channelId,
    channelName: channel?.name ?? null,
    threadRootId: row.threadRootId,
    messageId: row.messageId,
    description: row.description,
    resolverLabel,
  }
}

// One surface per person: the socket event reaches connected clients (which
// render the OS notification); the push covers whoever is offline.
async function notifyUsers(
  deps: NotifyDeps,
  userIds: string[],
  notification: ApprovalNotification
) {
  if (userIds.length === 0) return
  for (const userId of userIds) {
    deps.emitter
      .to(userRoom(userId))
      .emit("notification:approval", notification)
  }
  await sendApprovalPush({ userIds, notification, redis: deps.redis }).catch(
    (err) => {
      logger.error(
        { err, approvalId: notification.approvalId },
        "Approval push send failed"
      )
    }
  )
}

// Immediate phase, called right after the parked run goes terminal. Returns
// whether the escalation job should be scheduled.
export async function notifyApprovalParked(
  deps: NotifyDeps,
  approvalId: string
): Promise<{ scheduleEscalation: boolean }> {
  const row = await loadParkedApproval(approvalId)
  if (!row || row.status !== "pending") return { scheduleEscalation: false }

  const spec = await loadResolverSpec(row.workspaceId, row.target)
  const requesterId = await requesterOf(row)
  const { userIds, label } = await resolverAudience(
    row.workspaceId,
    spec,
    requesterId
  )

  if (requesterId && userIds.includes(requesterId)) {
    // The requester can self-approve: page only them now; everyone else waits
    // for the escalation (skipped when they were the whole audience anyway).
    await notifyUsers(
      deps,
      [requesterId],
      await buildNotification(row, "actionable", label)
    )
    return { scheduleEscalation: userIds.length > 1 }
  }

  await notifyUsers(
    deps,
    userIds,
    await buildNotification(row, "actionable", label)
  )
  if (requesterId) {
    await notifyUsers(
      deps,
      [requesterId],
      await buildNotification(row, "waiting", label)
    )
  }
  return { scheduleEscalation: false }
}

// Delayed phase: the requester was paged first but the gate is still pending —
// bring in the rest of the eligible set.
export async function escalateApproval(
  deps: NotifyDeps,
  approvalId: string
): Promise<void> {
  const row = await loadParkedApproval(approvalId)
  if (!row || row.status !== "pending") return

  const spec = await loadResolverSpec(row.workspaceId, row.target)
  const requesterId = await requesterOf(row)
  const { userIds, label } = await resolverAudience(
    row.workspaceId,
    spec,
    requesterId
  )
  const rest = userIds.filter((id) => id !== requesterId)
  await notifyUsers(
    deps,
    rest,
    await buildNotification(row, "actionable", label)
  )
}
